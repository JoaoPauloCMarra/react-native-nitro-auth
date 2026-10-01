import Foundation
import CommonCrypto

enum AuthCore {
  typealias RandomSource = (inout [UInt8]) -> Bool
  typealias Sha256Hex = (UnsafePointer<CChar>, Int, UnsafeMutablePointer<CChar>, Int) -> Int32
  typealias JwtPayloadJson = (UnsafePointer<CChar>, UnsafeMutablePointer<CChar>, Int) -> Int32

  struct Nonce: Equatable {
    let raw: String
    let hashed: String
  }

  struct MicrosoftTokens: Equatable {
    let idToken: String
    let accessToken: String
    let refreshToken: String
    let expirationTime: Double
    let claims: [String: String]
  }

  enum MicrosoftTokenOutcome: Equatable {
    case success(MicrosoftTokens)
    case failure(PlatformAuthErrorCode, String?)
  }

  enum MicrosoftCallback: Equatable {
    case code(String)
    case failure(PlatformAuthErrorCode, String?)
  }

  static let defaultMicrosoftScopes = ["openid", "email", "profile", "offline_access", "User.Read"]
  static let defaultMicrosoftExpiresInSeconds = 3600.0

  static let formUrlEncodedAllowedCharacters = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  )

  static let userStringFields = ["email", "name", "firstName", "lastName", "photo", "idToken", "accessToken",
                                 "refreshToken", "serverAuthCode", "authorizationCode", "userId", "phoneNumber", "hostedDomain"]

  static func base64Url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func createNonce(random: RandomSource, sha256Hex: Sha256Hex) -> Nonce? {
    var randomBytes = [UInt8](repeating: 0, count: 32)
    guard random(&randomBytes) else {
      return nil
    }

    let raw = base64Url(Data(randomBytes))
    var hashedChars = [CChar](repeating: 0, count: 65)
    let hashStatus = raw.withCString { pointer in
      hashedChars.withUnsafeMutableBufferPointer { buffer -> Int32 in
        guard let output = buffer.baseAddress else { return -1 }
        return sha256Hex(pointer, raw.utf8.count, output, buffer.count)
      }
    }
    guard hashStatus == 0 else { return nil }
    return Nonce(raw: raw, hashed: String(cString: hashedChars))
  }

  static func generateCodeVerifier(random: RandomSource) -> String? {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard random(&bytes) else {
      return nil
    }
    return base64Url(Data(bytes))
  }

  static func generateCodeChallenge(_ verifier: String) -> String? {
    guard let data = verifier.data(using: .ascii) else { return nil }
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    data.withUnsafeBytes {
      _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
    }
    return base64Url(Data(hash))
  }

  static func formUrlEncodedBody(_ params: [String: String]) -> Data? {
    params
      .map { key, value in
        let encodedKey = key.addingPercentEncoding(withAllowedCharacters: formUrlEncodedAllowedCharacters) ?? key
        let encodedValue = value.addingPercentEncoding(withAllowedCharacters: formUrlEncodedAllowedCharacters) ?? value
        return "\(encodedKey)=\(encodedValue)"
      }
      .joined(separator: "&")
      .data(using: .utf8)
  }

  static func mapOAuthError(_ oauthCode: String, context: String = "authorize") -> PlatformAuthErrorCode {
    let normalized = oauthCode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    var code = oauthErrorCodes[normalized] ?? .unknown
    if context == "refresh" && code == .tokenError {
      code = .refreshFailed
    }
    return code
  }

  static func shouldClearMicrosoftRefreshToken(statusCode: Int) -> Bool {
    (400...499).contains(statusCode) && statusCode != 408 && statusCode != 429
  }

  static func microsoftExpirationTime(expiresIn: Any?, nowSeconds: TimeInterval) -> Double {
    let seconds = (expiresIn as? Double).flatMap { $0 > 0 ? $0 : nil } ?? defaultMicrosoftExpiresInSeconds
    return nowSeconds * 1000 + seconds * 1000
  }

  static func googleExpirationTime(_ expirationDate: Date?) -> Double {
    (expirationDate?.timeIntervalSince1970 ?? 0) * 1000
  }

  static func microsoftRedirectUri(bundleId: String) -> String {
    "msauth.\(bundleId)://auth"
  }

  static func microsoftCallbackScheme(bundleId: String) -> String {
    "msauth.\(bundleId)"
  }

  static func mergedScopes(_ current: [String], adding scopes: [String]) -> [String] {
    (current + scopes).reduce(into: [String]()) { acc, s in
      if !acc.contains(s) { acc.append(s) }
    }
  }

  static func microsoftAuthorizeUrl(
    authBaseUrl: String,
    clientId: String,
    redirectUri: String,
    scopes: [String],
    state: String,
    nonce: String,
    codeChallenge: String,
    prompt: String,
    loginHint: String?
  ) -> URL? {
    guard var urlComponents = URLComponents(string: "\(authBaseUrl)oauth2/v2.0/authorize") else {
      return nil
    }
    urlComponents.queryItems = [
      URLQueryItem(name: "client_id", value: clientId),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "response_mode", value: "query"),
      URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "nonce", value: nonce),
      URLQueryItem(name: "code_challenge", value: codeChallenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "prompt", value: prompt)
    ]

    if let hint = loginHint {
      urlComponents.queryItems?.append(URLQueryItem(name: "login_hint", value: hint))
    }

    return urlComponents.url
  }

  static func microsoftTokenUrl(authBaseUrl: String) -> URL? {
    URL(string: "\(authBaseUrl)oauth2/v2.0/token")
  }

  static func classifyMicrosoftCallback(_ callbackURL: URL?, expectedState: String) -> MicrosoftCallback {
    guard let callbackURL = callbackURL,
          let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
      return .failure(.unknown, nil)
    }

    var params: [String: String] = [:]
    for item in components.queryItems ?? [] {
      params[item.name] = item.value
    }

    guard let returnedState = params["state"], returnedState == expectedState else {
      return .failure(.invalidState, nil)
    }

    if let errorCode = params["error"] {
      return .failure(mapOAuthError(errorCode, context: "authorize"), params["error_description"] ?? errorCode)
    }

    guard let code = params["code"] else {
      return .failure(.tokenError, nil)
    }
    return .code(code)
  }

  static func mapWebAuthSessionError(
    _ error: NSError,
    webAuthSessionErrorDomain: String,
    canceledLoginCode: Int
  ) -> PlatformAuthErrorCode {
    if error.domain == webAuthSessionErrorDomain && error.code == canceledLoginCode {
      return .cancelled
    }
    if error.domain.lowercased().contains("network") || error.code == NSURLErrorNotConnectedToInternet {
      return .networkError
    }
    return .unknown
  }

  static func mapProviderError(
    _ error: Error,
    appleErrorDomain: String,
    appleCanceledCode: Int,
    appleInvalidResponseCode: Int
  ) -> PlatformAuthErrorCode {
    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain {
      return .networkError
    }
    if nsError.domain == "com.google.GIDSignIn" {
      switch nsError.code {
      case -5: return .cancelled
      case -4: return .notSignedIn
      default: break
      }
    }
    if nsError.domain == appleErrorDomain {
      switch nsError.code {
      case appleCanceledCode: return .cancelled
      case appleInvalidResponseCode: return .configurationError
      default: return .unknown
      }
    }
    let msg = error.localizedDescription.lowercased()
    if msg.contains("cancel") { return .cancelled }
    if msg.contains("network") || msg.contains("internet") || msg.contains("offline") { return .networkError }
    return .unknown
  }

  static func decodeJwt(_ token: String, payloadJson: JwtPayloadJson) -> [String: String] {
    var payloadChars = [CChar](repeating: 0, count: max(token.utf8.count * 2, 8))
    let written = token.withCString { pointer in
      payloadChars.withUnsafeMutableBufferPointer { buffer -> Int32 in
        guard let output = buffer.baseAddress else { return -1 }
        return payloadJson(pointer, output, buffer.count)
      }
    }
    guard written >= 0, Int(written) <= payloadChars.count else { return [:] }
    let payloadBytes = payloadChars[0..<Int(written)].map { UInt8(bitPattern: $0) }
    guard let payload = String(bytes: payloadBytes, encoding: .utf8),
          let data = payload.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return [:]
    }

    var result: [String: String] = [:]
    for (key, value) in json {
      if let string = jwtClaimString(value) {
        result[key] = string
      }
    }
    return result
  }

  static func jwtClaimString(_ value: Any) -> String? {
    if let string = value as? String {
      return string
    }
    if let number = value as? NSNumber {
      let objCType = String(cString: number.objCType)
      if objCType == "c" || objCType == "B" {
        return number.boolValue ? "true" : "false"
      }
      return number.stringValue
    }
    return nil
  }

  static func getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?) -> String? {
    let trimmedTenant = tenant.trimmingCharacters(in: .whitespacesAndNewlines)

    if let domain = b2cDomain?.trimmingCharacters(in: .whitespacesAndNewlines), !domain.isEmpty {
      let normalizedDomain = domain.lowercased()
      guard isValidMicrosoftDomain(normalizedDomain) else { return nil }
      guard let b2cTenantPath = getMicrosoftB2cTenantPath(trimmedTenant, domain: normalizedDomain) else { return nil }
      return "https://\(normalizedDomain)/\(b2cTenantPath)/"
    }
    guard isValidMicrosoftTenant(trimmedTenant) else { return nil }
    return "https://login.microsoftonline.com/\(trimmedTenant)/"
  }

  private static func isValidMicrosoftTenant(_ value: String) -> Bool {
    return value.range(
      of: #"^(common|organizations|consumers|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$"#,
      options: .regularExpression
    ) != nil
  }

  private static func getMicrosoftB2cTenantPath(_ value: String, domain: String) -> String? {
    if isValidMicrosoftB2cTenantPath(value) {
      return value
    }
    guard isValidMicrosoftB2cPolicy(value),
          let tenantName = getMicrosoftB2cTenantName(domain) else { return nil }
    return "\(tenantName).onmicrosoft.com/\(value)"
  }

  private static func getMicrosoftB2cTenantName(_ domain: String) -> String? {
    let suffix = ".b2clogin.com"
    guard domain.hasSuffix(suffix) else { return nil }
    let tenantName = String(domain.dropLast(suffix.count))
    return tenantName.range(
      of: #"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"#,
      options: .regularExpression
    ) != nil ? tenantName : nil
  }

  private static func isValidMicrosoftB2cTenantPath(_ value: String) -> Bool {
    return value.range(
      of: #"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"#,
      options: .regularExpression
    ) != nil
  }

  private static func isValidMicrosoftB2cPolicy(_ value: String) -> Bool {
    return value.range(
      of: #"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"#,
      options: .regularExpression
    ) != nil
  }

  private static func isValidMicrosoftDomain(_ value: String) -> Bool {
    return value.range(
      of: #"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$"#,
      options: .regularExpression
    ) != nil
  }

  private static func jsonObject(_ data: Data?) -> [String: Any]? {
    guard let data = data else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private static func isFailureStatus(_ statusCode: Int?) -> Bool {
    guard let statusCode = statusCode else { return false }
    return !(200...299).contains(statusCode)
  }

  static func parseMicrosoftCodeExchange(
    data: Data?,
    statusCode: Int?,
    expectedNonce: String,
    nowSeconds: TimeInterval,
    decodeJwt: (String) -> [String: String]
  ) -> MicrosoftTokenOutcome {
    guard let json = jsonObject(data) else {
      return .failure(isFailureStatus(statusCode) ? .networkError : .parseError, nil)
    }

    if let errorCode = json["error"] as? String {
      return .failure(mapOAuthError(errorCode, context: "token"), json["error_description"] as? String)
    }

    if isFailureStatus(statusCode) {
      return .failure(.networkError, nil)
    }

    guard let idToken = json["id_token"] as? String else {
      return .failure(.noIdToken, nil)
    }

    let claims = decodeJwt(idToken)
    guard claims["nonce"] == expectedNonce else {
      return .failure(.invalidNonce, nil)
    }

    return .success(MicrosoftTokens(
      idToken: idToken,
      accessToken: json["access_token"] as? String ?? "",
      refreshToken: json["refresh_token"] as? String ?? "",
      expirationTime: microsoftExpirationTime(expiresIn: json["expires_in"], nowSeconds: nowSeconds),
      claims: claims
    ))
  }

  static func parseMicrosoftSilentRefresh(
    data: Data?,
    statusCode: Int?,
    nowSeconds: TimeInterval,
    decodeJwt: (String) -> [String: String]
  ) -> MicrosoftTokenOutcome {
    if isFailureStatus(statusCode) {
      if let json = jsonObject(data), let errorCode = json["error"] as? String {
        return .failure(mapOAuthError(errorCode, context: "refresh"), json["error_description"] as? String)
      }
      return .failure(.networkError, nil)
    }
    guard let json = jsonObject(data), let idToken = json["id_token"] as? String else {
      return .failure(.parseError, nil)
    }

    return .success(MicrosoftTokens(
      idToken: idToken,
      accessToken: json["access_token"] as? String ?? "",
      refreshToken: json["refresh_token"] as? String ?? "",
      expirationTime: microsoftExpirationTime(expiresIn: json["expires_in"], nowSeconds: nowSeconds),
      claims: decodeJwt(idToken)
    ))
  }

  static func parseMicrosoftTokenRefresh(
    data: Data?,
    statusCode: Int?,
    nowSeconds: TimeInterval
  ) -> MicrosoftTokenOutcome {
    guard let json = jsonObject(data) else {
      return .failure(isFailureStatus(statusCode) ? .networkError : .parseError, nil)
    }
    if let errorCode = json["error"] as? String {
      return .failure(mapOAuthError(errorCode, context: "refresh"), json["error_description"] as? String)
    }
    if isFailureStatus(statusCode) {
      return .failure(.networkError, nil)
    }
    return .success(MicrosoftTokens(
      idToken: json["id_token"] as? String ?? "",
      accessToken: json["access_token"] as? String ?? "",
      refreshToken: json["refresh_token"] as? String ?? "",
      expirationTime: microsoftExpirationTime(expiresIn: json["expires_in"], nowSeconds: nowSeconds),
      claims: [:]
    ))
  }

  static func microsoftUserData(_ tokens: MicrosoftTokens, scopes: [String]) -> [String: Any] {
    [
      "provider": "microsoft",
      "email": [tokens.claims["preferred_username"], tokens.claims["email"]].compactMap { $0 }.first { !$0.isEmpty } ?? "",
      "name": tokens.claims["name"] ?? "",
      "photo": "",
      "idToken": tokens.idToken,
      "accessToken": tokens.accessToken,
      "serverAuthCode": "",
      "scopes": scopes,
      "expirationTime": tokens.expirationTime,
    ]
  }

  static func microsoftTokensData(_ tokens: MicrosoftTokens) -> [String: Any] {
    [
      "accessToken": tokens.accessToken,
      "idToken": tokens.idToken,
      "expirationTime": tokens.expirationTime,
    ]
  }

  static func text(_ value: Any?) -> String? {
    guard let value = value as? String, !value.isEmpty else { return nil }
    return value
  }

  static func hasValidUserFieldTypes(_ data: NSDictionary) -> Bool {
    userStringFields.allSatisfy({ data[$0] == nil || data[$0] is NSNull || data[$0] is String }) &&
      (data["scopes"] == nil || data["scopes"] is NSNull || data["scopes"] is [String]) &&
      (data["expirationTime"] == nil || data["expirationTime"] is NSNull || data["expirationTime"] is NSNumber)
  }

  static func expirationTime(_ value: Any?) -> Double? {
    (value as? NSNumber)?.doubleValue
  }
}

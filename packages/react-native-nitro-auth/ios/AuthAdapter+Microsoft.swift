import Foundation
import AuthenticationServices
import CommonCrypto

extension AuthAdapter {
  static func loginMicrosoft(scopes: [String], loginHint: String?, tenant: String?, prompt: String?, operation: AuthAdapter.AuthOperationToken, completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }
    let effectiveTenant = tenant ?? Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    let redirectUri = "msauth.\(bundleId)://auth"
    let effectiveScopes = scopes.isEmpty ? ["openid", "email", "profile", "offline_access", "User.Read"] : scopes
    let effectivePrompt = prompt ?? "select_account"

    guard let codeVerifier = generateCodeVerifier() else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }
    guard let codeChallenge = generateCodeChallenge(codeVerifier) else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }
    let state = UUID().uuidString
    let nonce = UUID().uuidString

    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: effectiveTenant, b2cDomain: b2cDomain) else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }

    guard var urlComponents = URLComponents(string: "\(authBaseUrl)oauth2/v2.0/authorize") else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }
    urlComponents.queryItems = [
      URLQueryItem(name: "client_id", value: clientId),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "response_mode", value: "query"),
      URLQueryItem(name: "scope", value: effectiveScopes.joined(separator: " ")),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "nonce", value: nonce),
      URLQueryItem(name: "code_challenge", value: codeChallenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "prompt", value: effectivePrompt)
    ]

    if let hint = loginHint {
      urlComponents.queryItems?.append(URLQueryItem(name: "login_hint", value: hint))
    }

    guard let authUrl = urlComponents.url else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }

    let callbackScheme = "msauth.\(bundleId)"

    DispatchQueue.main.async {
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      guard self.activeMicrosoftWebAuthSession == nil else {
        completion(nil, NSNumber(value: AuthErrorCode.operationInProgress.rawValue), nil)
        return
      }

      let completeAndClearSession = { (data: NSDictionary?, code: NSNumber?, message: String?) in
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        self.activeMicrosoftWebAuthSession = nil
        self.activeMicrosoftWebAuthSessionEpoch = nil
        completion(data, code, message)
      }

      let session = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: callbackScheme) { callbackURL, error in
        if let error = error {
          let nsError = error as NSError
          if nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
            completeAndClearSession(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nsError.localizedDescription)
          } else if nsError.domain.lowercased().contains("network") || nsError.code == NSURLErrorNotConnectedToInternet {
            completeAndClearSession(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), nsError.localizedDescription)
          } else {
            completeAndClearSession(nil, NSNumber(value: AuthErrorCode.unknown.rawValue), nsError.localizedDescription)
          }
          return
        }

        guard let callbackURL = callbackURL,
              let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
          completeAndClearSession(nil, NSNumber(value: AuthErrorCode.unknown.rawValue), nil)
          return
        }

        var params: [String: String] = [:]
        for item in components.queryItems ?? [] {
          params[item.name] = item.value
        }

        if let errorCode = params["error"] {
          let mapped = mapOAuthError(errorCode, context: "authorize")
          completeAndClearSession(nil, NSNumber(value: mapped.rawValue), params["error_description"])
          return
        }

        guard let returnedState = params["state"], returnedState == state else {
          completeAndClearSession(nil, NSNumber(value: AuthErrorCode.invalidState.rawValue), nil)
          return
        }

        guard let code = params["code"] else {
          completeAndClearSession(nil, NSNumber(value: AuthErrorCode.tokenError.rawValue), nil)
          return
        }

        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        self.activeMicrosoftWebAuthSession = nil
        self.activeMicrosoftWebAuthSessionEpoch = nil
        exchangeCodeForTokens(
          code: code,
          codeVerifier: codeVerifier,
          clientId: clientId,
          redirectUri: redirectUri,
          tenant: effectiveTenant,
          b2cDomain: b2cDomain,
          expectedNonce: nonce,
          scopes: effectiveScopes,
          operation: operation,
          completion: completion
        )
      }

      guard let window = activeWindow() else {
        completeAndClearSession(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
        return
      }
      let contextProvider = WebAuthContextProvider(anchor: window)
      session.presentationContextProvider = contextProvider
      objc_setAssociatedObject(session, &contextProviderHandle, contextProvider, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      session.prefersEphemeralWebBrowserSession = false
      self.activeMicrosoftWebAuthSession = session
      self.activeMicrosoftWebAuthSessionEpoch = operation.epoch
      if !session.start() {
        completeAndClearSession(nil, NSNumber(value: AuthErrorCode.unknown.rawValue), nil)
      }
    }
  }

  static func generateCodeVerifier() -> String? {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      return nil
    }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func generateCodeChallenge(_ verifier: String) -> String? {
    guard let data = verifier.data(using: .ascii) else { return nil }
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    data.withUnsafeBytes {
      _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
    }
    return Data(hash).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
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

  static func exchangeCodeForTokens(
    code: String,
    codeVerifier: String,
    clientId: String,
    redirectUri: String,
    tenant: String,
    b2cDomain: String?,
    expectedNonce: String,
    scopes: [String],
    operation: AuthAdapter.AuthOperationToken,
    completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void
  ) {
    guard isCurrentOperation(operation) else {
      completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
      return
    }
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token") else {
      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      }
      return
    }

    var request = URLRequest(url: tokenUrl)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

    let bodyParams = [
      "client_id": clientId,
      "code": code,
      "redirect_uri": redirectUri,
      "grant_type": "authorization_code",
      "code_verifier": codeVerifier
    ]

    request.httpBody = formUrlEncodedBody(bodyParams)

    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        if let error = error {
          completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), error.localizedDescription)
          return
        }

        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
            completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), nil)
          } else {
            completion(nil, NSNumber(value: AuthErrorCode.parseError.rawValue), nil)
          }
          return
        }

        if let errorCode = json["error"] as? String {
          completion(nil, NSNumber(value: mapOAuthError(errorCode, context: "token").rawValue), json["error_description"] as? String)
          return
        }

        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
          completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), nil)
          return
        }

        guard let idToken = json["id_token"] as? String else {
          completion(nil, NSNumber(value: AuthErrorCode.noIdToken.rawValue), nil)
          return
        }

        let claims = decodeJwt(idToken)
        guard claims["nonce"] == expectedNonce else {
          completion(nil, NSNumber(value: AuthErrorCode.invalidNonce.rawValue), nil)
          return
        }

        let accessToken = json["access_token"] as? String ?? ""
        let refreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = (json["expires_in"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 3600.0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000

        let resultScopes = scopes.isEmpty ? defaultMicrosoftScopes : scopes
        guard self.commitCurrentOperation(operation, {
          if !refreshToken.isEmpty {
            inMemoryMicrosoftRefreshToken = refreshToken
          }
          inMemoryMicrosoftScopes = resultScopes
        }) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }

        let resultData: [String: Any] = [
          "provider": "microsoft",
          "email": claims["preferred_username"] ?? claims["email"] ?? "",
          "name": claims["name"] ?? "",
          "photo": "",
          "idToken": idToken,
          "accessToken": accessToken,
          "serverAuthCode": "",
          "scopes": resultScopes,
          "expirationTime": expirationTime,
        ]
        completion(resultData as NSDictionary, nil, nil)
      }
    }.resume()
  }

  static func decodeJwt(_ token: String) -> [String: String] {
    let parts = token.components(separatedBy: ".")
    guard parts.count >= 2 else { return [:] }

    var base64 = parts[1]
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = base64.count % 4
    if remainder > 0 {
      base64 += String(repeating: "=", count: 4 - remainder)
    }

    guard let data = Data(base64Encoded: base64),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return [:]
    }

    var result: [String: String] = [:]
    for (key, value) in json {
      if let str = value as? String {
        result[key] = str
      }
    }
    return result
  }

  static func requestMicrosoftTokenRefresh(
    refreshToken: String,
    operation: AuthAdapter.AuthOperationToken,
    completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void,
    onResponse: @escaping (Data?, URLResponse?, Error?) -> Void
  ) {
    guard isCurrentOperation(operation) else {
      completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
      return
    }
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }
    let tenant = Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token") else {
      completion(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
      return
    }
    var request = URLRequest(url: tokenUrl)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formUrlEncodedBody([
      "client_id": clientId,
      "grant_type": "refresh_token",
      "refresh_token": refreshToken
    ])
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async { onResponse(data, response, error) }
    }.resume()
  }

  static func tryMicrosoftSilentRefresh(
    completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void,
    operation: AuthAdapter.AuthOperationToken
  ) {
    tokenStoreLock.lock()
    let refreshToken = inMemoryMicrosoftRefreshToken
    let currentScopes = inMemoryMicrosoftScopes
    tokenStoreLock.unlock()
    guard let refreshToken = refreshToken else {
      completion(nil, NSNumber(value: AuthErrorCode.notSignedIn.rawValue), nil)
      return
    }

    requestMicrosoftTokenRefresh(refreshToken: refreshToken, operation: operation, completion: completion) { data, response, error in
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      if let error = error {
        completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), error.localizedDescription)
        return
      }
      if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
        if let data = data,
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let errorCode = json["error"] as? String {
          completion(nil, NSNumber(value: mapOAuthError(errorCode, context: "refresh").rawValue), json["error_description"] as? String)
        } else {
          completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), nil)
        }
        return
      }
      guard let data = data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let idToken = json["id_token"] as? String else {
        completion(nil, NSNumber(value: AuthErrorCode.parseError.rawValue), nil)
        return
      }

      let claims = decodeJwt(idToken)
      let accessToken = json["access_token"] as? String ?? ""
      let newRefreshToken = json["refresh_token"] as? String ?? ""
      let expiresIn = (json["expires_in"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 3600.0
      let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000

      guard self.commitCurrentOperation(operation, {
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
      }) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }

      let resultData: [String: Any] = [
        "provider": "microsoft",
        "email": claims["preferred_username"] ?? claims["email"] ?? "",
        "name": claims["name"] ?? "",
        "photo": "",
        "idToken": idToken,
        "accessToken": accessToken,
        "serverAuthCode": "",
        "scopes": currentScopes,
        "expirationTime": expirationTime
      ]
      completion(resultData as NSDictionary, nil, nil)
    }
  }

  static func tryMicrosoftRefreshForTokenRefresh(completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void, operation: AuthAdapter.AuthOperationToken) {
    tokenStoreLock.lock()
    let refreshToken = inMemoryMicrosoftRefreshToken
    tokenStoreLock.unlock()
    guard let refreshToken = refreshToken else {
      completion(nil, NSNumber(value: AuthErrorCode.notSignedIn.rawValue), nil)
      return
    }
    requestMicrosoftTokenRefresh(refreshToken: refreshToken, operation: operation, completion: completion) { data, response, error in
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      if let error = error {
        completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), error.localizedDescription)
        return
      }
      guard let data = data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
          completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), nil)
        } else {
          completion(nil, NSNumber(value: AuthErrorCode.parseError.rawValue), nil)
        }
        return
      }
      if let errorCode = json["error"] as? String {
        completion(nil, NSNumber(value: mapOAuthError(errorCode, context: "refresh").rawValue), json["error_description"] as? String)
        return
      }
      if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
        completion(nil, NSNumber(value: AuthErrorCode.networkError.rawValue), nil)
        return
      }
      let idToken = json["id_token"] as? String ?? ""
      let accessToken = json["access_token"] as? String ?? ""
      let newRefreshToken = json["refresh_token"] as? String ?? ""
      let expiresIn = (json["expires_in"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 3600.0
      let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000
      guard self.commitCurrentOperation(operation, {
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
      }) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      let tokensData: [String: Any] = [
        "accessToken": accessToken,
        "idToken": idToken,
        "expirationTime": expirationTime,
      ]
      completion(tokensData as NSDictionary, nil, nil)
    }
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
}

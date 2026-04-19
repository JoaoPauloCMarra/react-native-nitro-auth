import Foundation
import GoogleSignIn
import AuthenticationServices
import NitroModules
import CommonCrypto

@objc
public class AuthAdapter: NSObject {
  private static let defaultMicrosoftScopes = ["openid", "email", "profile", "offline_access", "User.Read"]
  private static var inMemoryMicrosoftRefreshToken: String?
  private static var inMemoryMicrosoftScopes: [String] = defaultMicrosoftScopes
  private static var inMemoryGoogleServerAuthCode: String?
  private static let tokenStoreLock = NSLock()

  @objc
  public static func login(provider: String, scopes: [String], loginHint: String?, useSheet: Bool, forceAccountPicker: Bool = false, tenant: String? = nil, prompt: String? = nil, completion: @escaping (NSDictionary?, String?) -> Void) {
    // useSheet is accepted for API compatibility with Android but has no effect on iOS.
    // Google Sign-In SDK controls its own presentation style.
    if provider == "google" {
      guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String, !clientId.isEmpty else {
        completion(nil, "configuration_error")
        return
      }
      
      let serverClientId = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String
      
      DispatchQueue.main.async {
        guard let rootVC = presentingViewController() else {
          completion(nil, "no_window")
          return
        }

        let config = GIDConfiguration(clientID: clientId, serverClientID: serverClientId)
        GIDSignIn.sharedInstance.configuration = config
        
        let additionalScopes = scopes.isEmpty ? nil : scopes
        let effectiveHint = forceAccountPicker ? nil : loginHint
        
        let performSignIn = {
          GIDSignIn.sharedInstance.signIn(withPresenting: rootVC, hint: effectiveHint, additionalScopes: additionalScopes) { result, error in
            self.handleGoogleResult(result, error: error, completion: completion)
          }
        }
        
        if forceAccountPicker {
          GIDSignIn.sharedInstance.disconnect { _ in
            performSignIn()
          }
        } else {
          performSignIn()
        }
      }
    } else if provider == "apple" {
      let appleIDProvider = ASAuthorizationAppleIDProvider()
      let request = appleIDProvider.createRequest()
      request.requestedScopes = [.fullName, .email]
      
      let controller = ASAuthorizationController(authorizationRequests: [request])
      let delegate = AppleSignInDelegate(completion: completion)
      controller.delegate = delegate
      objc_setAssociatedObject(controller, &delegateHandle, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

      DispatchQueue.main.async {
        guard let window = activeWindow() else {
          completion(nil, "no_window")
          return
        }
        let contextProvider = AppleSignInContextProvider(anchor: window)
        controller.presentationContextProvider = contextProvider
        objc_setAssociatedObject(controller, &contextProviderHandle, contextProvider, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        controller.performRequests()
      }
    } else if provider == "microsoft" {
      loginMicrosoft(scopes: scopes, loginHint: loginHint, tenant: tenant, prompt: prompt, completion: completion)
    } else {
      completion(nil, "unsupported_provider")
    }
  }

  private static func loginMicrosoft(scopes: [String], loginHint: String?, tenant: String?, prompt: String?, completion: @escaping (NSDictionary?, String?) -> Void) {
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, "configuration_error")
      return
    }
    
    let effectiveTenant = tenant ?? Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    let redirectUri = "msauth.\(bundleId)://auth"
    let effectiveScopes = scopes.isEmpty ? ["openid", "email", "profile", "offline_access", "User.Read"] : scopes
    let effectivePrompt = prompt ?? "select_account"
    
    guard let codeVerifier = generateCodeVerifier() else {
      completion(nil, "configuration_error")
      return
    }
    guard let codeChallenge = generateCodeChallenge(codeVerifier) else {
      completion(nil, "configuration_error")
      return
    }
    let state = UUID().uuidString
    let nonce = UUID().uuidString
    
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: effectiveTenant, b2cDomain: b2cDomain) else {
      completion(nil, "configuration_error")
      return
    }

    guard var urlComponents = URLComponents(string: "\(authBaseUrl)oauth2/v2.0/authorize") else {
      completion(nil, "configuration_error")
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
      completion(nil, "configuration_error")
      return
    }
    
    let callbackScheme = "msauth.\(bundleId)"
    
    DispatchQueue.main.async {
      let session = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: callbackScheme) { callbackURL, error in
        if let error = error {
          let nsError = error as NSError
          if nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
            completion(nil, "cancelled")
          } else if nsError.domain.lowercased().contains("network") || nsError.code == NSURLErrorNotConnectedToInternet {
            completion(nil, "network_error")
          } else {
            completion(nil, "unknown")
          }
          return
        }

        guard let callbackURL = callbackURL,
              let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
          completion(nil, "unknown")
          return
        }

        var params: [String: String] = [:]
        for item in components.queryItems ?? [] {
          params[item.name] = item.value
        }

        if let errorCode = params["error"] {
          // OAuth error codes are already structured (e.g. "access_denied").
          // Map well-known ones; fall back to "unknown".
          let mapped = mapOAuthError(errorCode)
          completion(nil, mapped)
          return
        }

        guard let returnedState = params["state"], returnedState == state else {
          completion(nil, "invalid_state")
          return
        }

        guard let code = params["code"] else {
          completion(nil, "unknown")
          return
        }
        
        exchangeCodeForTokens(
          code: code,
          codeVerifier: codeVerifier,
          clientId: clientId,
          redirectUri: redirectUri,
          tenant: effectiveTenant,
          b2cDomain: b2cDomain,
          expectedNonce: nonce,
          scopes: effectiveScopes,
          completion: completion
        )
      }

      guard let window = activeWindow() else {
        completion(nil, "no_window")
        return
      }
      let contextProvider = WebAuthContextProvider(anchor: window)
      session.presentationContextProvider = contextProvider
      objc_setAssociatedObject(session, &contextProviderHandle, contextProvider, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      session.prefersEphemeralWebBrowserSession = false
      session.start()
    }
  }
  
  private static func generateCodeVerifier() -> String? {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      return nil
    }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
  
  private static func generateCodeChallenge(_ verifier: String) -> String? {
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
  
  private static func exchangeCodeForTokens(
    code: String,
    codeVerifier: String,
    clientId: String,
    redirectUri: String,
    tenant: String,
    b2cDomain: String?,
    expectedNonce: String,
    scopes: [String],
    completion: @escaping (NSDictionary?, String?) -> Void
  ) {
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token") else {
      DispatchQueue.main.async { completion(nil, "configuration_error") }
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
    
    request.httpBody = bodyParams
      .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
      .joined(separator: "&")
      .data(using: .utf8)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        if error != nil {
          completion(nil, "network_error")
          return
        }

        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
            completion(nil, "network_error")
          } else {
            completion(nil, "parse_error")
          }
          return
        }

        if let errorCode = json["error"] as? String {
          completion(nil, mapOAuthError(errorCode))
          return
        }

        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
          completion(nil, "network_error")
          return
        }

        guard let idToken = json["id_token"] as? String else {
          completion(nil, "no_id_token")
          return
        }

        let claims = decodeJwt(idToken)
        guard claims["nonce"] == expectedNonce else {
          completion(nil, "invalid_nonce")
          return
        }
        
        let accessToken = json["access_token"] as? String ?? ""
        let refreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = (json["expires_in"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 3600.0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000
        
        tokenStoreLock.lock()
        if !refreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = refreshToken
        }
        inMemoryMicrosoftScopes = scopes.isEmpty ? defaultMicrosoftScopes : scopes
        tokenStoreLock.unlock()
        
        let resultData: [String: Any] = [
          "provider": "microsoft",
          "email": claims["preferred_username"] ?? claims["email"] ?? "",
          "name": claims["name"] ?? "",
          "photo": "",
          "idToken": idToken,
          "accessToken": accessToken,
          "serverAuthCode": "",
          "scopes": scopes,
          "expirationTime": expirationTime,
          "underlyingError": ""
        ]
        completion(resultData as NSDictionary, nil)
      }
    }.resume()
  }
  
  private static func decodeJwt(_ token: String) -> [String: String] {
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

  private static func handleGoogleResult(_ result: GIDSignInResult?, error: Error?, completion: @escaping (NSDictionary?, String?) -> Void) {
    if let error = error {
      completion(nil, mapError(error))
      return
    }
    
    guard let user = result?.user else {
      completion(nil, "unknown")
      return
    }
    
    let serverAuthCode = result?.serverAuthCode ?? ""
    tokenStoreLock.lock()
    inMemoryGoogleServerAuthCode = serverAuthCode.isEmpty ? nil : serverAuthCode
    tokenStoreLock.unlock()

    let data: [String: Any] = [
      "provider": "google",
      "email": user.profile?.email ?? "",
      "name": user.profile?.name ?? "",
      "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
      "idToken": user.idToken?.tokenString ?? "",
      "accessToken": user.accessToken.tokenString,
      "serverAuthCode": serverAuthCode,
      "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000,
      "underlyingError": ""
    ]
    completion(data as NSDictionary, nil)
  }

  static func mapError(_ error: Error) -> String {
    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain {
      return "network_error"
    }
    // GIDSignIn error codes
    if nsError.domain == "com.google.GIDSignIn" {
      switch nsError.code {
      case -5: return "cancelled"   // GIDSignInErrorCodeCanceled
      case -4: return "not_signed_in"  // GIDSignInErrorCodeNoCurrentUser
      default: break
      }
    }
    // ASAuthorizationError codes (Apple Sign-In / ASWebAuthenticationSession)
    if nsError.domain == ASAuthorizationError.errorDomain {
      switch nsError.code {
      case ASAuthorizationError.canceled.rawValue: return "cancelled"
      case ASAuthorizationError.invalidResponse.rawValue: return "configuration_error"
      default: return "unknown"
      }
    }
    let msg = error.localizedDescription.lowercased()
    if msg.contains("cancel") { return "cancelled" }
    if msg.contains("network") || msg.contains("internet") || msg.contains("offline") { return "network_error" }
    return "unknown"
  }

  /// Maps OAuth 2.0 error codes (returned in query params or JSON) to AuthErrorCode values.
  private static func mapOAuthError(_ oauthCode: String) -> String {
    switch oauthCode {
    case "access_denied": return "cancelled"
    case "invalid_client", "unauthorized_client", "invalid_scope": return "configuration_error"
    case "invalid_grant", "invalid_request": return "token_error"
    case "temporarily_unavailable", "server_error": return "network_error"
    default: return "unknown"
    }
  }

  @objc
  public static func addScopes(scopes: [String], completion: @escaping (NSDictionary?, String?) -> Void) {
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      DispatchQueue.main.async {
        guard let rootVC = presentingViewController() else {
          completion(nil, "no_window")
          return
        }
        currentUser.addScopes(scopes, presenting: rootVC) { result, error in
          self.handleGoogleResult(result, error: error, completion: completion)
        }
      }
      return
    }
    tokenStoreLock.lock()
    let hasRefreshToken = inMemoryMicrosoftRefreshToken != nil
    let currentScopes = inMemoryMicrosoftScopes
    tokenStoreLock.unlock()
    guard hasRefreshToken else {
      completion(nil, "not_signed_in")
      return
    }
    let mergedScopes = (currentScopes + scopes).reduce(into: [String]()) { acc, s in
      if !acc.contains(s) { acc.append(s) }
    }
    loginMicrosoft(scopes: mergedScopes, loginHint: nil, tenant: nil, prompt: nil, completion: completion)
  }

  @objc
  public static func refreshToken(completion: @escaping (NSDictionary?, String?) -> Void) {
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      currentUser.refreshTokensIfNeeded { user, error in
        if let error = error {
          completion(nil, mapError(error))
          return
        }
        guard let user = user else {
          completion(nil, "unknown")
          return
        }
        let data: [String: Any] = [
          "accessToken": user.accessToken.tokenString,
          "idToken": user.idToken?.tokenString ?? "",
          "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000,
          "underlyingError": ""
        ]
        completion(data as NSDictionary, nil)
      }
      return
    }
    tryMicrosoftRefreshForTokenRefresh(completion: completion)
  }

  @objc
  public static func initialize(completion: @escaping (NSDictionary?) -> Void) {
    if Bundle.main.object(forInfoDictionaryKey: "GIDClientID") != nil {
      GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
        if let user = user {
          tokenStoreLock.lock()
          let cachedServerAuthCode = inMemoryGoogleServerAuthCode
          tokenStoreLock.unlock()
          let data: [String: Any] = [
            "provider": "google",
            "email": user.profile?.email ?? "",
            "name": user.profile?.name ?? "",
            "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
            "idToken": user.idToken?.tokenString ?? "",
            "accessToken": user.accessToken.tokenString,
            "serverAuthCode": cachedServerAuthCode ?? "",
            "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000
          ]
          completion(data as NSDictionary)
          return
        }
        self.tryMicrosoftSilentRefresh(completion: completion)
      }
    } else {
      self.tryMicrosoftSilentRefresh(completion: completion)
    }
  }

  private static func tryMicrosoftSilentRefresh(completion: @escaping (NSDictionary?) -> Void) {
    tokenStoreLock.lock()
    let refreshToken = inMemoryMicrosoftRefreshToken
    let currentScopes = inMemoryMicrosoftScopes
    tokenStoreLock.unlock()
    guard let refreshToken = refreshToken else {
      completion(nil)
      return
    }
    
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil)
      return
    }
    
    let tenant = Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token") else {
      completion(nil)
      return
    }

    var request = URLRequest(url: tokenUrl)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

    let bodyParams = [
      "client_id": clientId,
      "grant_type": "refresh_token",
      "refresh_token": refreshToken
    ]
    
    request.httpBody = bodyParams
      .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
      .joined(separator: "&")
      .data(using: .utf8)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        if let error = error {
          #if DEBUG
          print("[NitroAuth] Microsoft silent refresh network error: \(error.localizedDescription)")
          #endif
          completion(nil)
          return
        }
        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
          #if DEBUG
          print("[NitroAuth] Microsoft silent refresh HTTP \(httpResponse.statusCode)")
          #endif
          completion(nil)
          return
        }
        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = json["id_token"] as? String else {
          #if DEBUG
          print("[NitroAuth] Microsoft silent refresh: failed to parse token response")
          #endif
          completion(nil)
          return
        }

        let claims = decodeJwt(idToken)
        let accessToken = json["access_token"] as? String ?? ""
        let newRefreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = (json["expires_in"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 3600.0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000

        tokenStoreLock.lock()
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
        tokenStoreLock.unlock()

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
        completion(resultData as NSDictionary)
      }
    }.resume()
  }

  private static func tryMicrosoftRefreshForTokenRefresh(completion: @escaping (NSDictionary?, String?) -> Void) {
    tokenStoreLock.lock()
    let refreshToken = inMemoryMicrosoftRefreshToken
    tokenStoreLock.unlock()
    guard let refreshToken = refreshToken else {
      completion(nil, "not_signed_in")
      return
    }
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, "configuration_error")
      return
    }
    let tenant = Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token") else {
      completion(nil, "configuration_error")
      return
    }
    var request = URLRequest(url: tokenUrl)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let bodyParams = [
      "client_id": clientId,
      "grant_type": "refresh_token",
      "refresh_token": refreshToken
    ]
    request.httpBody = bodyParams
      .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
      .joined(separator: "&")
      .data(using: .utf8)
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        if error != nil {
          completion(nil, "network_error")
          return
        }
        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
            completion(nil, "network_error")
          } else {
            completion(nil, "parse_error")
          }
          return
        }
        if let errorCode = json["error"] as? String {
          completion(nil, AuthAdapter.mapOAuthError(errorCode))
          return
        }
        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
          completion(nil, "network_error")
          return
        }
        let idToken = json["id_token"] as? String ?? ""
        let accessToken = json["access_token"] as? String ?? ""
        let newRefreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = (json["expires_in"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 3600.0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000
        tokenStoreLock.lock()
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
        tokenStoreLock.unlock()
        let tokensData: [String: Any] = [
          "accessToken": accessToken,
          "idToken": idToken,
          "expirationTime": expirationTime,
          "underlyingError": ""
        ]
        completion(tokensData as NSDictionary, nil)
      }
    }.resume()
  }
  
  private static func getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?) -> String? {
    let trimmedTenant = tenant.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedTenant.isEmpty else { return nil }

    if trimmedTenant.hasPrefix("https://") {
      guard URL(string: trimmedTenant) != nil else { return nil }
      return trimmedTenant.hasSuffix("/") ? trimmedTenant : "\(trimmedTenant)/"
    }
    if let domain = b2cDomain?.trimmingCharacters(in: .whitespacesAndNewlines), !domain.isEmpty {
      return "https://\(domain)/tfp/\(trimmedTenant)/"
    }
    return "https://login.microsoftonline.com/\(trimmedTenant)/"
  }

  @objc
  public static func logout() {
    GIDSignIn.sharedInstance.signOut()
    tokenStoreLock.lock()
    inMemoryMicrosoftRefreshToken = nil
    inMemoryMicrosoftScopes = defaultMicrosoftScopes
    inMemoryGoogleServerAuthCode = nil
    tokenStoreLock.unlock()
  }

  private static func activeWindow() -> UIWindow? {
    let windowScenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter {
        $0.activationState == .foregroundActive ||
          $0.activationState == .foregroundInactive
      }

    for scene in windowScenes {
      if let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) {
        return keyWindow
      }
    }

    return windowScenes.lazy.compactMap { $0.windows.first }.first
  }

  private static func presentingViewController() -> UIViewController? {
    guard let rootViewController = activeWindow()?.rootViewController else {
      return nil
    }

    var current = rootViewController
    while let presented = current.presentedViewController {
      current = presented
    }
    if let navigationController = current as? UINavigationController {
      return navigationController.visibleViewController ?? navigationController
    }
    if let tabBarController = current as? UITabBarController {
      return tabBarController.selectedViewController ?? tabBarController
    }
    return current
  }
}

private var delegateHandle: UInt8 = 0
private var contextProviderHandle: UInt8 = 0

class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate {
  let completion: (NSDictionary?, String?) -> Void
  
  init(completion: @escaping (NSDictionary?, String?) -> Void) {
    self.completion = completion
  }
  
  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
      let email = appleIDCredential.email
      let fullName = appleIDCredential.fullName
      let name = [fullName?.givenName, fullName?.familyName].compactMap { $0 }.joined(separator: " ")
      let idToken = appleIDCredential.identityToken.flatMap { String(data: $0, encoding: .utf8) }
      
      let data: [String: Any] = [
        "provider": "apple",
        "email": email ?? "",
        "name": name,
        "idToken": idToken ?? "",
        "underlyingError": ""
      ]
      completion(data as NSDictionary, nil)
    } else {
      completion(nil, "unknown")
    }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    completion(nil, AuthAdapter.mapError(error))
  }
}

class AppleSignInContextProvider: NSObject, ASAuthorizationControllerPresentationContextProviding {
  let anchor: ASPresentationAnchor

  init(anchor: ASPresentationAnchor) {
    self.anchor = anchor
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    return anchor
  }
}

class WebAuthContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
  let anchor: ASPresentationAnchor
  
  init(anchor: ASPresentationAnchor) {
    self.anchor = anchor
  }
  
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return anchor
  }
}

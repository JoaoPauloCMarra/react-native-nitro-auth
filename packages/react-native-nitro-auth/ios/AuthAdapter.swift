import Foundation
import GoogleSignIn
import AuthenticationServices
import NitroModules
import ObjectiveC
import CommonCrypto

@objc
public class AuthAdapter: NSObject {
  private static let defaultMicrosoftScopes = ["openid", "email", "profile", "offline_access", "User.Read"]
  private static var inMemoryMicrosoftRefreshToken: String?
  private static var inMemoryMicrosoftScopes: [String] = defaultMicrosoftScopes
  private static var inMemoryGoogleServerAuthCode: String?

  @objc
  public static func login(provider: String, scopes: [String], loginHint: String?, useSheet: Bool, forceAccountPicker: Bool = false, tenant: String? = nil, prompt: String? = nil, completion: @escaping (NSDictionary?, String?) -> Void) {
    if provider == "google" {
      guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String, !clientId.isEmpty else {
        completion(nil, "configuration_error")
        return
      }
      
      let serverClientId = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String
      
      DispatchQueue.main.async {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootVC = windowScene.windows.first?.rootViewController else {
          completion(nil, "No root view controller found")
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
      controller.performRequests()
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
    
    let codeVerifier = generateCodeVerifier()
    let codeChallenge = generateCodeChallenge(codeVerifier)
    let state = UUID().uuidString
    let nonce = UUID().uuidString
    
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: effectiveTenant, b2cDomain: b2cDomain)
    
    var urlComponents = URLComponents(string: "\(authBaseUrl)oauth2/v2.0/authorize")!
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
          if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
            completion(nil, "cancelled")
          } else {
            completion(nil, error.localizedDescription)
          }
          return
        }
        
        guard let callbackURL = callbackURL,
              let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
          completion(nil, "No response from Microsoft")
          return
        }
        
        var params: [String: String] = [:]
        for item in components.queryItems ?? [] {
          params[item.name] = item.value
        }
        
        if let errorCode = params["error"] {
          completion(nil, params["error_description"] ?? errorCode)
          return
        }
        
        guard let returnedState = params["state"], returnedState == state else {
          completion(nil, "State mismatch - possible CSRF attack")
          return
        }
        
        guard let code = params["code"] else {
          completion(nil, "No authorization code in response")
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
      
      guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
            let rootVC = windowScene.windows.first?.rootViewController else {
        completion(nil, "No root view controller found")
        return
      }
      
      let contextProvider = WebAuthContextProvider(anchor: rootVC.view.window!)
      session.presentationContextProvider = contextProvider
      objc_setAssociatedObject(session, &contextProviderHandle, contextProvider, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      session.prefersEphemeralWebBrowserSession = false
      session.start()
    }
  }
  
  private static func generateCodeVerifier() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
  
  private static func generateCodeChallenge(_ verifier: String) -> String {
    guard let data = verifier.data(using: .ascii) else { return "" }
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
    let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain)
    let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token")!
    
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
        if let error = error {
          completion(nil, error.localizedDescription)
          return
        }
        
        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          completion(nil, "Failed to parse token response")
          return
        }
        
        if let errorCode = json["error"] as? String {
          let desc = json["error_description"] as? String ?? errorCode
          completion(nil, desc)
          return
        }
        
        guard let idToken = json["id_token"] as? String else {
          completion(nil, "No id_token in token response")
          return
        }
        
        let claims = decodeJwt(idToken)
        guard claims["nonce"] == expectedNonce else {
          completion(nil, "Nonce mismatch - token may be replayed")
          return
        }
        
        let accessToken = json["access_token"] as? String ?? ""
        let refreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = json["expires_in"] as? Double ?? 0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000
        
        if !refreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = refreshToken
        }
        inMemoryMicrosoftScopes = scopes.isEmpty ? defaultMicrosoftScopes : scopes
        
        let resultData: [String: Any] = [
          "provider": "microsoft",
          "email": claims["preferred_username"] ?? claims["email"] ?? "",
          "name": claims["name"] ?? "",
          "photo": "",
          "idToken": idToken,
          "accessToken": accessToken,
          "serverAuthCode": "",
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
      completion(nil, error.localizedDescription)
      return
    }
    
    guard let user = result?.user else {
      completion(nil, "unknown")
      return
    }
    
    let serverAuthCode = result?.serverAuthCode ?? ""
    inMemoryGoogleServerAuthCode = serverAuthCode.isEmpty ? nil : serverAuthCode

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
    if nsError.domain == "com.google.GIDSignIn" {
      if nsError.code == -5 { return "cancelled" }
    }
    let msg = error.localizedDescription.lowercased()
    if msg.contains("cancel") { return "cancelled" }
    if msg.contains("network") { return "network_error" }
    return "unknown"
  }

  @objc
  public static func addScopes(scopes: [String], completion: @escaping (NSDictionary?, String?) -> Void) {
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      DispatchQueue.main.async {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootVC = windowScene.windows.first?.rootViewController else {
          completion(nil, "No root view controller found")
          return
        }
        currentUser.addScopes(scopes, presenting: rootVC) { result, error in
          self.handleGoogleResult(result, error: error, completion: completion)
        }
      }
      return
    }
    guard inMemoryMicrosoftRefreshToken != nil else {
      completion(nil, "No user logged in")
      return
    }
    let mergedScopes = Array(Set(inMemoryMicrosoftScopes + scopes))
    loginMicrosoft(scopes: mergedScopes, loginHint: nil, tenant: nil, prompt: nil, completion: completion)
  }

  @objc
  public static func refreshToken(completion: @escaping (NSDictionary?, String?) -> Void) {
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      currentUser.refreshTokensIfNeeded { user, error in
        if let error = error {
          completion(nil, error.localizedDescription)
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
          let data: [String: Any] = [
            "provider": "google",
            "email": user.profile?.email ?? "",
            "name": user.profile?.name ?? "",
            "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
            "idToken": user.idToken?.tokenString ?? "",
            "accessToken": user.accessToken.tokenString,
            "serverAuthCode": inMemoryGoogleServerAuthCode ?? "",
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
    guard let refreshToken = inMemoryMicrosoftRefreshToken else {
      completion(nil)
      return
    }
    
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil)
      return
    }
    
    let tenant = Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain)
    let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token")!
    
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
        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = json["id_token"] as? String else {
          completion(nil)
          return
        }
        
        let claims = decodeJwt(idToken)
        let accessToken = json["access_token"] as? String ?? ""
        let newRefreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = json["expires_in"] as? Double ?? 0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000
        
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
        
        let resultData: [String: Any] = [
          "provider": "microsoft",
          "email": claims["preferred_username"] ?? claims["email"] ?? "",
          "name": claims["name"] ?? "",
          "photo": "",
          "idToken": idToken,
          "accessToken": accessToken,
          "serverAuthCode": "",
          "expirationTime": expirationTime
        ]
        completion(resultData as NSDictionary)
      }
    }.resume()
  }

  private static func tryMicrosoftRefreshForTokenRefresh(completion: @escaping (NSDictionary?, String?) -> Void) {
    guard let refreshToken = inMemoryMicrosoftRefreshToken else {
      completion(nil, "No user logged in")
      return
    }
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, "configuration_error")
      return
    }
    let tenant = Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain)
    let tokenUrl = URL(string: "\(authBaseUrl)oauth2/v2.0/token")!
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
          completion(nil, error.localizedDescription)
          return
        }
        guard let data = data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          completion(nil, "Token refresh failed")
          return
        }
        if let errorCode = json["error"] as? String {
          completion(nil, (json["error_description"] as? String) ?? errorCode)
          return
        }
        let idToken = json["id_token"] as? String ?? ""
        let accessToken = json["access_token"] as? String ?? ""
        let newRefreshToken = json["refresh_token"] as? String ?? ""
        let expiresIn = json["expires_in"] as? Double ?? 0
        let expirationTime = Date().timeIntervalSince1970 * 1000 + expiresIn * 1000
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
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
  
  private static func getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?) -> String {
    if tenant.hasPrefix("https://") {
      return tenant.hasSuffix("/") ? tenant : "\(tenant)/"
    }
    
    if let domain = b2cDomain {
      return "https://\(domain)/tfp/\(tenant)/"
    } else {
      return "https://login.microsoftonline.com/\(tenant)/"
    }
  }

  @objc
  public static func logout() {
    GIDSignIn.sharedInstance.signOut()
    inMemoryMicrosoftRefreshToken = nil
    inMemoryMicrosoftScopes = defaultMicrosoftScopes
    inMemoryGoogleServerAuthCode = nil
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
    }
  }
  
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    completion(nil, error.localizedDescription)
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

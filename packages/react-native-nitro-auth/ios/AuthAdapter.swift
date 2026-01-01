import Foundation
import GoogleSignIn
import AuthenticationServices
import NitroModules
import ObjectiveC

@objc
public class AuthAdapter: NSObject {
  @objc
  public static func login(provider: String, scopes: [String], loginHint: String?, completion: @escaping (NSDictionary?, String?) -> Void) {
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
        GIDSignIn.sharedInstance.signIn(withPresenting: rootVC, hint: loginHint, additionalScopes: additionalScopes) { result, error in
          if let error = error {
            completion(nil, AuthAdapter.mapError(error))
            return
          }
          
          guard let user = result?.user else {
            completion(nil, "unknown")
            return
          }
          
          let data: [String: Any] = [
            "provider": "google",
            "email": user.profile?.email ?? "",
            "name": user.profile?.name ?? "",
            "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
            "idToken": user.idToken?.tokenString ?? "",
            "accessToken": user.accessToken.tokenString,
            "serverAuthCode": result?.serverAuthCode ?? "",
            "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000
          ]
          completion(data as NSDictionary, nil)
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
    } else {
      completion(nil, "unsupported_provider")
    }
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
    guard let currentUser = GIDSignIn.sharedInstance.currentUser else {
      completion(nil, "No Google user signed in")
      return
    }
    
    DispatchQueue.main.async {
      guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
            let rootVC = windowScene.windows.first?.rootViewController else {
        completion(nil, "No root view controller found")
        return
      }
      
      currentUser.addScopes(scopes, presenting: rootVC) { result, error in
        if let error = error {
          completion(nil, AuthAdapter.mapError(error))
          return
        }
        
        guard let user = result?.user else {
          completion(nil, "unknown")
          return
        }
        
        let data: [String: Any] = [
          "provider": "google",
          "email": user.profile?.email ?? "",
          "name": user.profile?.name ?? "",
          "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
          "idToken": user.idToken?.tokenString ?? "",
          "accessToken": user.accessToken.tokenString,
          "serverAuthCode": result?.serverAuthCode ?? "",
          "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000
        ]
        completion(data as NSDictionary, nil)
      }
    }
  }

  @objc
  public static func refreshToken(completion: @escaping (NSDictionary?, String?) -> Void) {
    guard let currentUser = GIDSignIn.sharedInstance.currentUser else {
      completion(nil, "No Google user signed in")
      return
    }
    
    currentUser.refreshTokensIfNeeded { user, error in
      if let error = error {
        completion(nil, AuthAdapter.mapError(error))
        return
      }
      
      guard let user = user else {
        completion(nil, "unknown")
        return
      }
      
      let data: [String: Any] = [
        "accessToken": user.accessToken.tokenString,
        "idToken": user.idToken?.tokenString ?? "",
        "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000
      ]
      completion(data as NSDictionary, nil)
    }
  }

  @objc
  public static func initialize(completion: @escaping (NSDictionary?) -> Void) {
    guard Bundle.main.object(forInfoDictionaryKey: "GIDClientID") != nil else {
      completion(nil)
      return
    }
    
    GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
      if let user = user {
        let data: [String: Any] = [
          "provider": "google",
          "email": user.profile?.email ?? "",
          "name": user.profile?.name ?? "",
          "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
          "idToken": user.idToken?.tokenString ?? "",
          "accessToken": user.accessToken.tokenString,
          "serverAuthCode": "",
          "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000
        ]
        completion(data as NSDictionary)
        return
      }
      completion(nil)
    }
  }

  @objc
  public static func logout() {
    GIDSignIn.sharedInstance.signOut()
  }
}

private var delegateHandle: UInt8 = 0

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
        "idToken": idToken ?? ""
      ]
      completion(data as NSDictionary, nil)
    }
  }
  
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    completion(nil, AuthAdapter.mapError(error))
  }
}

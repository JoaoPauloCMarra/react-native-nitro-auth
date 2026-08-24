import Foundation
import AuthenticationServices
import GoogleSignIn

extension AuthAdapter {
  static func invokeGoogleAddScopes(
    _ currentUser: GIDGoogleUser,
    scopes: [String],
    presenting rootViewController: UIViewController,
    operation: AuthAdapter.AuthOperationToken,
    completion: @escaping (GIDSignInResult?, Error?) -> Void
  ) -> Bool {
    tokenStoreLock.lock()
    guard authEpoch == operation.epoch, activeOperation === operation,
          operation.providerInvocation.claim() else {
      tokenStoreLock.unlock()
      return false
    }

    currentUser.addScopes(scopes, presenting: rootViewController) { result, error in
      DispatchQueue.main.async {
        completion(result, error)
      }
    }
    tokenStoreLock.unlock()
    return true
  }

  static func handleGoogleResult(_ result: GIDSignInResult?, error: Error?, operation: AuthAdapter.AuthOperationToken, completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    if let error = error {
      completion(nil, NSNumber(value: mapError(error).rawValue), error.localizedDescription)
      return
    }

    guard let user = result?.user else {
      completion(nil, NSNumber(value: AuthErrorCode.unknown.rawValue), nil)
      return
    }

    let serverAuthCode = result?.serverAuthCode ?? ""
    guard commitCurrentOperation(operation, {
      inMemoryGoogleServerAuthCode = serverAuthCode.isEmpty ? nil : serverAuthCode
    }) else {
      completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
      return
    }
    guard isCurrentOperation(operation) else {
      completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
      return
    }

    let data: [String: Any] = [
      "provider": "google",
      "email": user.profile?.email ?? "",
      "name": user.profile?.name ?? "",
      "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
      "idToken": user.idToken?.tokenString ?? "",
      "accessToken": user.accessToken.tokenString,
      "serverAuthCode": serverAuthCode,
      "userId": user.userID ?? "",
      "hostedDomain": user.configuration.hostedDomain ?? "",
      "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000,
    ]
    completion(data as NSDictionary, nil, nil)
  }

  @objc
  public static func revokeAccess(
    provider: String,
    completion: @escaping (NSNumber?, String?) -> Void
  ) {
    let operation = beginOperation()
    guard provider == "google" else {
      completion(NSNumber(value: AuthErrorCode.unsupportedProvider.rawValue), nil)
      return
    }
    guard GIDSignIn.sharedInstance.currentUser != nil else {
      completion(NSNumber(value: AuthErrorCode.notSignedIn.rawValue), nil)
      return
    }

    GIDSignIn.sharedInstance.disconnect { error in
      guard self.isCurrentOperation(operation) else {
        completion(NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      if let error = error {
        completion(NSNumber(value: mapError(error).rawValue), error.localizedDescription)
        return
      }
      guard self.commitCurrentOperation(operation, {
        inMemoryGoogleServerAuthCode = nil
      }) else {
        completion(NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      completion(nil, nil)
    }
  }

  static func mapError(_ error: Error) -> AuthErrorCode {
    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain {
      return .networkError
    }
    // GIDSignIn error codes
    if nsError.domain == "com.google.GIDSignIn" {
      switch nsError.code {
      case -5: return .cancelled   // GIDSignInErrorCodeCanceled
      case -4: return .notSignedIn  // GIDSignInErrorCodeNoCurrentUser
      default: break
      }
    }
    // ASAuthorizationError codes (Apple Sign-In / ASWebAuthenticationSession)
    if nsError.domain == ASAuthorizationError.errorDomain {
      switch nsError.code {
      case ASAuthorizationError.canceled.rawValue: return .cancelled
      case ASAuthorizationError.invalidResponse.rawValue: return .configurationError
      default: return .unknown
      }
    }
    let msg = error.localizedDescription.lowercased()
    if msg.contains("cancel") { return .cancelled }
    if msg.contains("network") || msg.contains("internet") || msg.contains("offline") { return .networkError }
    return .unknown
  }
}

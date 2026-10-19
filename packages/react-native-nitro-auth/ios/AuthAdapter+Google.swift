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

  static func googleUserData(_ user: GIDGoogleUser, idToken: String, serverAuthCode: String) -> [String: Any] {
    [
      "provider": "google",
      "email": user.profile?.email ?? "",
      "name": user.profile?.name ?? "",
      "firstName": user.profile?.givenName ?? "",
      "lastName": user.profile?.familyName ?? "",
      "photo": user.profile?.imageURL(withDimension: 300)?.absoluteString ?? "",
      "idToken": idToken,
      "accessToken": user.accessToken.tokenString,
      "serverAuthCode": serverAuthCode,
      "userId": user.userID ?? "",
      "hostedDomain": user.configuration.hostedDomain ?? "",
      "expirationTime": AuthCore.googleExpirationTime(user.accessToken.expirationDate),
    ]
  }

  static func handleGoogleResult(_ result: GIDSignInResult?, error: Error?, operation: AuthAdapter.AuthOperationToken, expectedNonce: String? = nil, completion: @escaping (ProviderOutcome) -> Void) {
    if let error = error {
      completion(.failure(mapError(error), error.localizedDescription))
      return
    }

    guard let user = result?.user else {
      completion(.failure(.unknown))
      return
    }

    let idToken = user.idToken?.tokenString
    if let expectedNonce = expectedNonce {
      guard let idToken = idToken, !idToken.isEmpty else {
        completion(.failure(.noIdToken))
        return
      }
      guard AuthAdapter.decodeJwt(idToken)["nonce"] == expectedNonce else {
        completion(.failure(.invalidNonce))
        return
      }
    }

    let serverAuthCode = result?.serverAuthCode ?? ""
    guard commitCurrentOperation(operation, {
      activateSession(.google)
      inMemoryGoogleServerAuthCode = serverAuthCode.isEmpty ? nil : serverAuthCode
    }) else {
      completion(.cancelled)
      return
    }
    guard isCurrentOperation(operation) else {
      completion(.cancelled)
      return
    }

    let data = googleUserData(user, idToken: idToken ?? "", serverAuthCode: serverAuthCode)
    completion(.success(data as NSDictionary))
  }

  static func completeGoogleScopesAlreadyGranted(
    _ user: GIDGoogleUser,
    operation: AuthAdapter.AuthOperationToken,
    completion: @escaping (ProviderOutcome) -> Void
  ) {
    var serverAuthCode = ""
    guard commitCurrentOperation(operation, {
      activateSession(.google)
      serverAuthCode = inMemoryGoogleServerAuthCode ?? ""
    }) else {
      completion(.cancelled)
      return
    }
    let data = googleUserData(user, idToken: user.idToken?.tokenString ?? "", serverAuthCode: serverAuthCode)
    completion(.success(data as NSDictionary))
  }

  static func revokeAccess(
    provider: String,
    completion: @escaping (ProviderOutcome) -> Void
  ) {
    let operation = advanceOperation()
    guard provider == "google" else {
      completion(.failure(.unsupportedProvider))
      return
    }
    guard GIDSignIn.sharedInstance.currentUser != nil else {
      completion(.failure(.notSignedIn))
      return
    }

    GIDSignIn.sharedInstance.disconnect { error in
      guard self.isCurrentOperation(operation) else {
        completion(.cancelled)
        return
      }
      if let error = error {
        completion(.failure(mapError(error), error.localizedDescription))
        return
      }
      guard self.commitCurrentOperation(operation, {
        inMemoryGoogleServerAuthCode = nil
      }) else {
        completion(.cancelled)
        return
      }
      completion(.success([:]))
    }
  }

  static func mapError(_ error: Error) -> PlatformAuthErrorCode {
    AuthCore.mapProviderError(
      error,
      appleErrorDomain: ASAuthorizationError.errorDomain,
      appleCanceledCode: ASAuthorizationError.canceled.rawValue,
      appleInvalidResponseCode: ASAuthorizationError.invalidResponse.rawValue,
      appleUnknownCode: ASAuthorizationError.unknown.rawValue
    )
  }
}

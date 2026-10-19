import Foundation
import AuthenticationServices

var delegateHandle: UInt8 = 0
var contextProviderHandle: UInt8 = 0

extension AuthAdapter {
  static func activeWindow() -> UIWindow? {
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

  static func presentingViewController() -> UIViewController? {
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

class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate {
  let expectedNonce: String?
  let completion: (ProviderOutcome) -> Void

  init(expectedNonce: String?, completion: @escaping (ProviderOutcome) -> Void) {
    self.expectedNonce = expectedNonce
    self.completion = completion
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
      let email = appleIDCredential.email
      let fullName = appleIDCredential.fullName
      let name = [fullName?.givenName, fullName?.familyName].compactMap { $0 }.joined(separator: " ")
      let idToken = appleIDCredential.identityToken.flatMap { String(data: $0, encoding: .utf8) }

      // When a nonce was requested, verify the identity token carries it.
      // Apple SDKs bind the nonce into the token; the claim check prevents a
      // replayed or swapped token from being accepted.
      if let expectedNonce = expectedNonce {
        guard let idToken = idToken, !idToken.isEmpty else {
          completion(.failure(.noIdToken))
          return
        }
        let claims = AuthAdapter.decodeJwt(idToken)
        guard claims["nonce"] == expectedNonce else {
          completion(.failure(.invalidNonce))
          return
        }
      }

      let data: [String: Any] = [
        "provider": "apple",
        "email": email ?? "",
        "name": name,
        "firstName": fullName?.givenName ?? "",
        "lastName": fullName?.familyName ?? "",
        "idToken": idToken ?? "",
        "authorizationCode": appleIDCredential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? "",
        "userId": appleIDCredential.user,
      ]
      completion(.success(data as NSDictionary))
    } else {
      completion(.failure(.unknown))
    }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let detail = AuthCore.appleErrorDetail(
      error,
      appleErrorDomain: ASAuthorizationError.errorDomain,
      appleUnknownCode: ASAuthorizationError.unknown.rawValue
    )
    completion(.failure(AuthAdapter.mapError(error), detail))
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

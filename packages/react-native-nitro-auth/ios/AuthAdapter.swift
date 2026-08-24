import Foundation
import GoogleSignIn
import AuthenticationServices
import NitroModules
import CommonCrypto

@objc
public class AuthAdapter: NSObject {
  final class OperationInvocationGate {
    private let lock = NSLock()
    private var invalidated = false
    private var claimed = false

    func invalidate() {
      lock.lock()
      invalidated = true
      lock.unlock()
    }

    func claim() -> Bool {
      lock.lock()
      defer { lock.unlock() }
      guard !invalidated, !claimed else { return false }
      claimed = true
      return true
    }
  }

  final class AuthOperationToken {
    let epoch: UInt64
    let providerInvocation = OperationInvocationGate()

    init(epoch: UInt64) {
      self.epoch = epoch
    }
  }

  private final class CompletionGate {
    private let lock = NSLock()
    private var completed = false

    func claim() -> Bool {
      lock.lock()
      defer { lock.unlock() }
      guard !completed else { return false }
      completed = true
      return true
    }
  }

  static let defaultMicrosoftScopes = ["openid", "email", "profile", "offline_access", "User.Read"]
  static var inMemoryMicrosoftRefreshToken: String?
  static var inMemoryMicrosoftScopes: [String] = defaultMicrosoftScopes
  static var inMemoryGoogleServerAuthCode: String?
  static var activeMicrosoftWebAuthSession: ASWebAuthenticationSession?
  static var activeMicrosoftWebAuthSessionEpoch: UInt64?
  private static var activeAppleSignInController: ASAuthorizationController?
  static let tokenStoreLock = NSLock()
  private static let interactiveAuthLock = NSLock()
  private static var interactiveAuthInProgress = false
  static var authEpoch: UInt64 = 0
  static var activeOperation: AuthOperationToken?

  static let formUrlEncodedAllowedCharacters = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  )

  static func advanceOperation() -> AuthOperationToken {
    tokenStoreLock.lock()
    let invalidatedEpoch = authEpoch
    let invalidatedOperation = activeOperation
    authEpoch = authEpoch == UInt64.max ? 1 : authEpoch + 1
    let operation = AuthOperationToken(epoch: authEpoch)
    invalidatedOperation?.providerInvocation.invalidate()
    activeOperation = operation
    tokenStoreLock.unlock()
    finishInteractiveAuth()
    DispatchQueue.main.async {
      guard activeMicrosoftWebAuthSessionEpoch == invalidatedEpoch else {
        return
      }
      activeMicrosoftWebAuthSession?.cancel()
      activeMicrosoftWebAuthSession = nil
      activeMicrosoftWebAuthSessionEpoch = nil
    }
    return operation
  }

  static func beginOperation() -> AuthOperationToken {
    advanceOperation()
  }

  static func isCurrentOperation(_ operation: AuthOperationToken) -> Bool {
    tokenStoreLock.lock()
    let isCurrent = authEpoch == operation.epoch
    tokenStoreLock.unlock()
    return isCurrent
  }

  static func commitCurrentOperation(_ operation: AuthOperationToken, _ mutation: () -> Void) -> Bool {
    tokenStoreLock.lock()
    defer { tokenStoreLock.unlock() }
    guard authEpoch == operation.epoch, activeOperation === operation else { return false }
    mutation()
    return true
  }

  private static func beginInteractiveAuth() -> Bool {
    interactiveAuthLock.lock()
    defer { interactiveAuthLock.unlock() }
    if interactiveAuthInProgress {
      return false
    }
    interactiveAuthInProgress = true
    return true
  }

  private static func finishInteractiveAuth() {
    interactiveAuthLock.lock()
    activeAppleSignInController = nil
    interactiveAuthInProgress = false
    interactiveAuthLock.unlock()
  }

  static func completeInteractiveAuth(_ operation: AuthOperationToken, _ completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) -> (NSDictionary?, NSNumber?, String?) -> Void {
    let gate = CompletionGate()
    return { data, code, message in
      guard gate.claim() else { return }
      guard isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      finishInteractiveAuth()
      completion(data, code, message)
    }
  }

  private static func completeOperation(_ operation: AuthOperationToken, _ completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) -> (NSDictionary?, NSNumber?, String?) -> Void {
    let gate = CompletionGate()
    return { data, code, message in
      guard gate.claim() else { return }
      guard isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
        return
      }
      completion(data, code, message)
    }
  }

  @objc
  public static func login(provider: String, scopes: [String], loginHint: String?, nonce: String?, useSheet: Bool, forceAccountPicker: Bool = false, tenant: String? = nil, prompt: String? = nil, hostedDomain: String? = nil, openIDRealm: String? = nil, completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    let operation = beginOperation()
    if provider == "google" {
      guard beginInteractiveAuth() else {
        completion(nil, NSNumber(value: AuthErrorCode.operationInProgress.rawValue), nil)
        return
      }
      let complete = completeInteractiveAuth(operation, completion)
      guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String, !clientId.isEmpty else {
        complete(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
        return
      }

      let serverClientId = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String

      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          complete(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        guard let rootVC = presentingViewController() else {
          complete(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
          return
        }

        let config = GIDConfiguration(clientID: clientId, serverClientID: serverClientId, hostedDomain: hostedDomain, openIDRealm: openIDRealm)
        GIDSignIn.sharedInstance.configuration = config

        let additionalScopes = scopes.isEmpty ? nil : scopes
        let shouldForceAccountPicker = forceAccountPicker || useSheet
        let effectiveHint = shouldForceAccountPicker ? nil : loginHint

        let performSignIn = {
          guard self.isCurrentOperation(operation) else {
            complete(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
            return
          }
          GIDSignIn.sharedInstance.signIn(withPresenting: rootVC, hint: effectiveHint, additionalScopes: additionalScopes, nonce: nonce) { result, error in
            self.handleGoogleResult(result, error: error, operation: operation, completion: complete)
          }
        }

        if shouldForceAccountPicker {
          GIDSignIn.sharedInstance.disconnect { _ in
            performSignIn()
          }
        } else {
          performSignIn()
        }
      }
    } else if provider == "apple" {
      guard beginInteractiveAuth() else {
        completion(nil, NSNumber(value: AuthErrorCode.operationInProgress.rawValue), nil)
        return
      }
      let complete = completeInteractiveAuth(operation, completion)
      let appleIDProvider = ASAuthorizationAppleIDProvider()
      let request = appleIDProvider.createRequest()
      request.requestedScopes = scopes.isEmpty
        ? [.fullName, .email]
        : scopes.compactMap { scope in
          switch scope {
          case "fullName", "name": return .fullName
          case "email": return .email
          default: return nil
          }
        }
      if let nonce = nonce {
        request.nonce = nonce
      }

      let controller = ASAuthorizationController(authorizationRequests: [request])
      let delegate = AppleSignInDelegate(expectedNonce: nonce, completion: complete)
      controller.delegate = delegate
      interactiveAuthLock.lock()
      activeAppleSignInController = controller
      interactiveAuthLock.unlock()
      objc_setAssociatedObject(controller, &delegateHandle, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          complete(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        guard let window = activeWindow() else {
          complete(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
          return
        }
        let contextProvider = AppleSignInContextProvider(anchor: window)
        controller.presentationContextProvider = contextProvider
        objc_setAssociatedObject(controller, &contextProviderHandle, contextProvider, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        controller.performRequests()
      }
    } else if provider == "microsoft" {
      loginMicrosoft(scopes: scopes, loginHint: loginHint, tenant: tenant, prompt: prompt, operation: operation, completion: completion)
    } else {
      completion(nil, NSNumber(value: AuthErrorCode.unsupportedProvider.rawValue), nil)
    }
  }

  @objc
  public static func addScopes(scopes: [String], completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    let operation = beginOperation()
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      let complete = completeOperation(operation, completion)
      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          complete(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        guard let rootVC = presentingViewController() else {
          complete(nil, NSNumber(value: AuthErrorCode.configurationError.rawValue), nil)
          return
        }
        guard self.invokeGoogleAddScopes(
          currentUser,
          scopes: scopes,
          presenting: rootVC,
          operation: operation,
          completion: { result, error in
            self.handleGoogleResult(result, error: error, operation: operation, completion: complete)
          }
        ) else {
          complete(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
      }
      return
    }
    tokenStoreLock.lock()
    let hasRefreshToken = inMemoryMicrosoftRefreshToken != nil
    let currentScopes = inMemoryMicrosoftScopes
    tokenStoreLock.unlock()
    guard hasRefreshToken else {
      completion(nil, NSNumber(value: AuthErrorCode.notSignedIn.rawValue), nil)
      return
    }
    let mergedScopes = (currentScopes + scopes).reduce(into: [String]()) { acc, s in
      if !acc.contains(s) { acc.append(s) }
    }
    loginMicrosoft(scopes: mergedScopes, loginHint: nil, tenant: nil, prompt: nil, operation: operation, completion: completion)
  }

  @objc
  public static func refreshToken(completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    let operation = beginOperation()
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      currentUser.refreshTokensIfNeeded { user, error in
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        if let error = error {
          completion(nil, NSNumber(value: mapError(error).rawValue), error.localizedDescription)
          return
        }
        guard let user = user else {
          completion(nil, NSNumber(value: AuthErrorCode.unknown.rawValue), nil)
          return
        }
        let data: [String: Any] = [
          "accessToken": user.accessToken.tokenString,
          "idToken": user.idToken?.tokenString ?? "",
          "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000,
        ]
        completion(data as NSDictionary, nil, nil)
      }
      return
    }
    tryMicrosoftRefreshForTokenRefresh(completion: completion, operation: operation)
  }

  @objc
  public static func initialize(completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    let operation = beginOperation()
    if Bundle.main.object(forInfoDictionaryKey: "GIDClientID") != nil {
      GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: AuthErrorCode.cancelled.rawValue), nil)
          return
        }
        if let error = error {
          let mappedError = mapError(error)
          if mappedError != .notSignedIn {
            completion(nil, NSNumber(value: mappedError.rawValue), error.localizedDescription)
            return
          }
        }
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
          "userId": user.userID ?? "",
          "hostedDomain": user.configuration.hostedDomain ?? "",
          "expirationTime": (user.accessToken.expirationDate?.timeIntervalSince1970 ?? 0) * 1000
          ]
          completion(data as NSDictionary, nil, nil)
          return
        }
        self.tryMicrosoftSilentRefresh(completion: completion, operation: operation)
      }
    } else {
      self.tryMicrosoftSilentRefresh(completion: completion, operation: operation)
    }
  }

  @objc
  public static func cancelPendingOperations() {
    _ = advanceOperation()
  }

  @objc
  public static func logout() {
    _ = beginOperation()
    GIDSignIn.sharedInstance.signOut()
    tokenStoreLock.lock()
    inMemoryMicrosoftRefreshToken = nil
    inMemoryMicrosoftScopes = defaultMicrosoftScopes
    inMemoryGoogleServerAuthCode = nil
    tokenStoreLock.unlock()
  }
}

import Foundation
import GoogleSignIn
import AuthenticationServices
import NitroModules
import Security

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

  static let defaultMicrosoftScopes = AuthCore.defaultMicrosoftScopes
  static var inMemoryMicrosoftRefreshToken: String?
  static var inMemoryMicrosoftScopes: [String] = defaultMicrosoftScopes
  static var inMemoryMicrosoftTenant: String?
  static var inMemoryGoogleServerAuthCode: String?
  static var activeMicrosoftWebAuthSession: ASWebAuthenticationSession?
  static var activeMicrosoftWebAuthSessionEpoch: UInt64?
  private static var activeAppleSignInController: ASAuthorizationController?
  static let tokenStoreLock = NSLock()
  private static let appleSignInControllerLock = NSLock()
  static var authEpoch: UInt64 = 0
  static var activeOperation: AuthOperationToken?

  @objc
  public static func createNonce() -> NSDictionary? {
    guard let nonce = AuthCore.createNonce(
      random: { bytes in SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess }
    ) else {
      return nil
    }
    return ["raw": nonce.raw, "hashed": nonce.hashed] as NSDictionary
  }

  static func advanceOperation() -> AuthOperationToken {
    tokenStoreLock.lock()
    let invalidatedEpoch = authEpoch
    let invalidatedOperation = activeOperation
    authEpoch = authEpoch == UInt64.max ? 1 : authEpoch + 1
    let operation = AuthOperationToken(epoch: authEpoch)
    invalidatedOperation?.providerInvocation.invalidate()
    activeOperation = operation
    tokenStoreLock.unlock()
    releaseAppleSignInController()
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

  static func observeCurrentOperation() -> AuthOperationToken {
    tokenStoreLock.lock()
    defer { tokenStoreLock.unlock() }
    return AuthOperationToken(epoch: authEpoch)
  }

  static func isCurrentOperation(_ operation: AuthOperationToken) -> Bool {
    tokenStoreLock.lock()
    let isCurrent = authEpoch == operation.epoch
    tokenStoreLock.unlock()
    return isCurrent
  }

  enum SessionProvider {
    case google
    case microsoft
    case apple
  }

  static func activateSession(_ provider: SessionProvider) {
    switch provider {
    case .google:
      inMemoryMicrosoftRefreshToken = nil
      inMemoryMicrosoftScopes = defaultMicrosoftScopes
      inMemoryMicrosoftTenant = nil
    case .microsoft:
      inMemoryGoogleServerAuthCode = nil
      signOutGoogleOnMainQueue()
    case .apple:
      inMemoryMicrosoftRefreshToken = nil
      inMemoryMicrosoftScopes = defaultMicrosoftScopes
      inMemoryMicrosoftTenant = nil
      inMemoryGoogleServerAuthCode = nil
      signOutGoogleOnMainQueue()
    }
  }

  static func signOutGoogleOnMainQueue() {
    DispatchQueue.main.async {
      GIDSignIn.sharedInstance.signOut()
    }
  }

  static func commitCurrentOperation(_ operation: AuthOperationToken, _ mutation: () -> Void) -> Bool {
    tokenStoreLock.lock()
    defer { tokenStoreLock.unlock() }
    guard authEpoch == operation.epoch else { return false }
    mutation()
    return true
  }

  private static func releaseAppleSignInController() {
    appleSignInControllerLock.lock()
    activeAppleSignInController = nil
    appleSignInControllerLock.unlock()
  }

  static func completeOperation(_ operation: AuthOperationToken, releasingAppleSignIn: Bool = false, _ completion: @escaping (ProviderOutcome) -> Void) -> (ProviderOutcome) -> Void {
    let gate = CompletionGate()
    return { outcome in
      guard gate.claim() else { return }
      guard isCurrentOperation(operation) else {
        completion(.cancelled)
        return
      }
      if releasingAppleSignIn { releaseAppleSignInController() }
      completion(outcome)
    }
  }

  static func login(provider: String, scopes: [String], loginHint: String?, nonce: String?, useSheet: Bool, forceAccountPicker: Bool = false, tenant: String? = nil, prompt: String? = nil, hostedDomain: String? = nil, openIDRealm: String? = nil, completion: @escaping (ProviderOutcome) -> Void) {
    let operation = advanceOperation()
    if provider == "google" {
      let complete = completeOperation(operation, releasingAppleSignIn: true, completion)
      guard let clientId = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String, !clientId.isEmpty else {
        complete(.failure(.configurationError))
        return
      }

      let serverClientId = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String

      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          complete(.cancelled)
          return
        }
        guard let rootVC = presentingViewController() else {
          complete(.failure(.configurationError))
          return
        }

        let config = GIDConfiguration(clientID: clientId, serverClientID: serverClientId, hostedDomain: hostedDomain, openIDRealm: openIDRealm)
        GIDSignIn.sharedInstance.configuration = config

        let additionalScopes = scopes.isEmpty ? nil : scopes
        let shouldForceAccountPicker = forceAccountPicker || useSheet
        let effectiveHint = shouldForceAccountPicker ? nil : loginHint

        let performSignIn = {
          guard self.isCurrentOperation(operation) else {
            complete(.cancelled)
            return
          }
          GIDSignIn.sharedInstance.signIn(withPresenting: rootVC, hint: effectiveHint, additionalScopes: additionalScopes, nonce: nonce) { result, error in
            self.handleGoogleResult(result, error: error, operation: operation, expectedNonce: nonce, completion: complete)
          }
        }

        if shouldForceAccountPicker {
          GIDSignIn.sharedInstance.signOut()
        }
        performSignIn()
      }
    } else if provider == "apple" {
      let complete = completeOperation(operation, releasingAppleSignIn: true) { outcome in
        guard case .success = outcome else {
          completion(outcome)
          return
        }
        guard commitCurrentOperation(operation, { activateSession(.apple) }) else {
          completion(.cancelled)
          return
        }
        completion(outcome)
      }
      let appleIDProvider = ASAuthorizationAppleIDProvider()
      let request = appleIDProvider.createRequest()
      request.requestedScopes = AuthCore.appleRequestedScopes(scopes).map { scope in
        switch scope {
        case .fullName: return .fullName
        case .email: return .email
        }
      }
      if let nonce = nonce {
        request.nonce = nonce
      }

      let controller = ASAuthorizationController(authorizationRequests: [request])
      let delegate = AppleSignInDelegate(expectedNonce: nonce, completion: complete)
      controller.delegate = delegate
      appleSignInControllerLock.lock()
      activeAppleSignInController = controller
      appleSignInControllerLock.unlock()
      objc_setAssociatedObject(controller, &delegateHandle, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          complete(.cancelled)
          return
        }
        guard let window = activeWindow() else {
          complete(.failure(.configurationError))
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
      completion(.failure(.unsupportedProvider))
    }
  }

  static func addScopes(scopes: [String], completion: @escaping (ProviderOutcome) -> Void) {
    let operation = advanceOperation()
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      let complete = completeOperation(operation, completion)
      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          complete(.cancelled)
          return
        }
        guard let rootVC = presentingViewController() else {
          complete(.failure(.configurationError))
          return
        }
        guard self.invokeGoogleAddScopes(
          currentUser,
          scopes: scopes,
          presenting: rootVC,
          operation: operation,
          completion: { result, error in
            if AuthCore.isGoogleScopesAlreadyGranted(error) {
              self.completeGoogleScopesAlreadyGranted(currentUser, operation: operation, completion: complete)
              return
            }
            self.handleGoogleResult(result, error: error, operation: operation, completion: complete)
          }
        ) else {
          complete(.cancelled)
          return
        }
      }
      return
    }
    tokenStoreLock.lock()
    let hasRefreshToken = inMemoryMicrosoftRefreshToken != nil
    let currentScopes = inMemoryMicrosoftScopes
    let loginTenant = inMemoryMicrosoftTenant
    tokenStoreLock.unlock()
    guard hasRefreshToken else {
      completion(.failure(.notSignedIn))
      return
    }
    let mergedScopes = AuthCore.mergedScopes(currentScopes, adding: scopes)
    loginMicrosoft(scopes: mergedScopes, loginHint: nil, tenant: loginTenant, prompt: nil, keepRefreshToken: true, operation: operation, completion: completion)
  }

  static func refreshToken(completion: @escaping (ProviderOutcome) -> Void) {
    let operation = observeCurrentOperation()
    if let currentUser = GIDSignIn.sharedInstance.currentUser {
      currentUser.refreshTokensIfNeeded { user, error in
        guard self.isCurrentOperation(operation) else {
          completion(.cancelled)
          return
        }
        if let error = error {
          completion(.failure(mapError(error), error.localizedDescription))
          return
        }
        guard let user = user else {
          completion(.failure(.unknown))
          return
        }
        let data: [String: Any] = [
          "accessToken": user.accessToken.tokenString,
          "idToken": user.idToken?.tokenString ?? "",
          "expirationTime": AuthCore.googleExpirationTime(user.accessToken.expirationDate),
        ]
        completion(.success(data as NSDictionary))
      }
      return
    }
    tryMicrosoftRefreshForTokenRefresh(completion: completion, operation: operation)
  }

  static func initialize(completion: @escaping (ProviderOutcome) -> Void) {
    let operation = advanceOperation()
    if Bundle.main.object(forInfoDictionaryKey: "GIDClientID") != nil {
      GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
        guard self.isCurrentOperation(operation) else {
          completion(.cancelled)
          return
        }
        if let error = error {
          let mappedError = mapError(error)
          if mappedError != .notSignedIn {
            completion(.failure(mappedError, error.localizedDescription))
            return
          }
        }
        if let user = user {
          tokenStoreLock.lock()
          let cachedServerAuthCode = inMemoryGoogleServerAuthCode
          tokenStoreLock.unlock()
          let data = googleUserData(user, idToken: user.idToken?.tokenString ?? "", serverAuthCode: cachedServerAuthCode ?? "")
          completion(.success(data as NSDictionary))
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
    _ = advanceOperation()
    GIDSignIn.sharedInstance.signOut()
    tokenStoreLock.lock()
    inMemoryMicrosoftRefreshToken = nil
    inMemoryMicrosoftScopes = defaultMicrosoftScopes
    inMemoryMicrosoftTenant = nil
    inMemoryGoogleServerAuthCode = nil
    tokenStoreLock.unlock()
  }
}

import Foundation
import NitroModules

final class HybridNativeAuthAdapter: HybridNativeAuthAdapterSpec {
  private let lock = NSLock()
  private var pending: [UUID: () -> Void] = [:]

  private func request<T>(cancelled: T, start: (@escaping (T) -> Void) -> Void) -> Promise<T> {
    let promise = Promise<T>()
    let id = UUID()
    lock.lock()
    pending[id] = { promise.resolve(withResult: cancelled) }
    lock.unlock()
    start { [self] result in
      lock.lock()
      let active = pending.removeValue(forKey: id) != nil
      lock.unlock()
      if active { promise.resolve(withResult: result) }
    }
    return promise
  }

  private static func failure(_ code: PlatformAuthErrorCode, _ detail: String?) -> ProviderFailure {
    let mapped: AuthErrorCode
    switch code {
    case .refreshFailed: mapped = .refreshFailed
    case .cancelled: mapped = .cancelled
    case .interactionRequired: mapped = .interactionRequired
    case .timeout: mapped = .timeout
    case .popupBlocked: mapped = .popupBlocked
    case .networkError: mapped = .networkError
    case .configurationError: mapped = .configurationError
    case .notSignedIn: mapped = .notSignedIn
    case .operationInProgress: mapped = .operationInProgress
    case .unsupportedProvider: mapped = .unsupportedProvider
    case .invalidState: mapped = .invalidState
    case .invalidNonce: mapped = .invalidNonce
    case .tokenError: mapped = .tokenError
    case .noIdToken: mapped = .noIdToken
    case .parseError: mapped = .parseError
    case .unknown: mapped = .unknown
    }
    return ProviderFailure(code: mapped, detail: detail)
  }

  private static func text(_ value: Any?) -> String? {
    AuthCore.text(value)
  }

  private static func userResult(_ outcome: ProviderOutcome) -> ProviderUserResult {
    let data: NSDictionary
    switch outcome {
    case .failure(let code, let detail): return ProviderUserResult(user: nil, failure: failure(code, detail))
    case .success(let payload): data = payload
    }
    guard let providerName = data["provider"] as? String,
          let provider = AuthProvider(fromString: providerName) else {
      return ProviderUserResult(user: nil, failure: ProviderFailure(code: .parseError, detail: nil))
    }
    guard AuthCore.hasValidUserFieldTypes(data) else {
      return ProviderUserResult(user: nil, failure: ProviderFailure(code: .parseError, detail: nil))
    }
    let user = AuthUser(provider: provider, email: text(data["email"]), name: text(data["name"]),
      firstName: text(data["firstName"]), lastName: text(data["lastName"]), photo: text(data["photo"]),
      idToken: text(data["idToken"]), accessToken: text(data["accessToken"]),
      refreshToken: text(data["refreshToken"]), serverAuthCode: text(data["serverAuthCode"]),
      authorizationCode: text(data["authorizationCode"]), userId: text(data["userId"]),
      phoneNumber: text(data["phoneNumber"]), hostedDomain: text(data["hostedDomain"]),
      scopes: data["scopes"] as? [String], expirationTime: AuthCore.expirationTime(data["expirationTime"]),
      underlyingError: nil)
    return ProviderUserResult(user: user, failure: nil)
  }

  func createNonce() throws -> AuthNonce {
    guard let data = AuthAdapter.createNonce(), let raw = data["raw"] as? String,
          let hashed = data["hashed"] as? String else {
      throw RuntimeError.error(withMessage: "configuration_error")
    }
    return AuthNonce(raw: raw, hashed: hashed)
  }
  func login(provider: AuthProvider, options: LoginOptions?) throws -> Promise<ProviderUserResult> {
    let providerName = provider.stringValue
    return request(cancelled: ProviderUserResult(user: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.login(provider: providerName,
        scopes: AuthCore.effectiveLoginScopes(provider: providerName, scopes: options?.scopes), loginHint: options?.loginHint,
        nonce: options?.nonce, useSheet: options?.useSheet ?? false, forceAccountPicker: options?.forceAccountPicker ?? false,
        tenant: options?.tenant, prompt: options?.prompt?.stringValue, hostedDomain: options?.hostedDomain,
        openIDRealm: options?.openIDRealm) { finish(Self.userResult($0)) }
    }
  }
  func requestScopes(scopes: [String]) throws -> Promise<ProviderUserResult> {
    request(cancelled: ProviderUserResult(user: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.addScopes(scopes: scopes) { finish(Self.userResult($0)) }
    }
  }
  func silentRestore() throws -> Promise<ProviderUserResult> {
    request(cancelled: ProviderUserResult(user: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.initialize { finish(Self.userResult($0)) }
    }
  }
  func refreshToken() throws -> Promise<ProviderTokenResult> {
    request(cancelled: ProviderTokenResult(tokens: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.refreshToken { outcome in
        let data: NSDictionary
        switch outcome {
        case .failure(let code, let detail): finish(ProviderTokenResult(tokens: nil, failure: Self.failure(code, detail))); return
        case .success(let payload): data = payload
        }
        finish(ProviderTokenResult(tokens: AuthTokens(accessToken: Self.text(data["accessToken"]),
          idToken: Self.text(data["idToken"]), refreshToken: Self.text(data["refreshToken"]),
          expirationTime: AuthCore.expirationTime(data["expirationTime"])), failure: nil))
      }
    }
  }
  func revokeAccess(provider: AuthProvider) throws -> Promise<ProviderVoidResult> {
    request(cancelled: ProviderVoidResult(failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.revokeAccess(provider: provider.stringValue) { outcome in
        guard case .failure(let code, let detail) = outcome else { finish(ProviderVoidResult(failure: nil)); return }
        finish(ProviderVoidResult(failure: Self.failure(code, detail)))
      }
    }
  }
  func hasPlayServices() throws -> Bool { true }
  func invalidatePendingOperations() throws { AuthAdapter.cancelPendingOperations() }
  func cancel() throws {
    AuthAdapter.cancelPendingOperations()
    lock.lock()
    let callbacks = Array(pending.values)
    pending.removeAll()
    lock.unlock()
    callbacks.forEach { $0() }
  }
  func logout() throws {
    try cancel()
    AuthAdapter.logout()
  }
}

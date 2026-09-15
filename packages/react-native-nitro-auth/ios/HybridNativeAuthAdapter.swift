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

  private static func failure(_ code: NSNumber?, _ detail: String?) -> ProviderFailure? {
    guard let code else { return nil }
    let mapped: AuthErrorCode
    switch PlatformAuthErrorCode.fromRawValue(code.intValue) {
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

  private static func userResult(_ data: NSDictionary?, _ code: NSNumber?, _ detail: String?) -> ProviderUserResult {
    if let failure = failure(code, detail) { return ProviderUserResult(user: nil, failure: failure) }
    guard let data, let providerName = data["provider"] as? String,
          let provider = AuthProvider(fromString: providerName) else {
      return ProviderUserResult(user: nil, failure: ProviderFailure(code: .parseError, detail: nil))
    }
    let stringFields = ["email", "name", "firstName", "lastName", "photo", "idToken", "accessToken",
                        "refreshToken", "serverAuthCode", "authorizationCode", "userId", "phoneNumber", "hostedDomain"]
    guard stringFields.allSatisfy({ data[$0] == nil || data[$0] is NSNull || data[$0] is String }),
          data["scopes"] == nil || data["scopes"] is NSNull || data["scopes"] is [String],
          data["expirationTime"] == nil || data["expirationTime"] is NSNull || data["expirationTime"] is NSNumber else {
      return ProviderUserResult(user: nil, failure: ProviderFailure(code: .parseError, detail: nil))
    }
    let user = AuthUser(provider: provider, email: data["email"] as? String, name: data["name"] as? String,
      firstName: data["firstName"] as? String, lastName: data["lastName"] as? String, photo: data["photo"] as? String,
      idToken: data["idToken"] as? String, accessToken: data["accessToken"] as? String,
      refreshToken: data["refreshToken"] as? String, serverAuthCode: data["serverAuthCode"] as? String,
      authorizationCode: data["authorizationCode"] as? String, userId: data["userId"] as? String,
      phoneNumber: data["phoneNumber"] as? String, hostedDomain: data["hostedDomain"] as? String,
      scopes: data["scopes"] as? [String], expirationTime: (data["expirationTime"] as? NSNumber)?.doubleValue,
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
    request(cancelled: ProviderUserResult(user: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.login(provider: provider.stringValue, scopes: options?.scopes ?? [], loginHint: options?.loginHint,
        nonce: options?.nonce, useSheet: options?.useSheet ?? false, forceAccountPicker: options?.forceAccountPicker ?? false,
        tenant: options?.tenant, prompt: options?.prompt?.stringValue, hostedDomain: options?.hostedDomain,
        openIDRealm: options?.openIDRealm) { finish(Self.userResult($0, $1, $2)) }
    }
  }
  func requestScopes(scopes: [String]) throws -> Promise<ProviderUserResult> {
    request(cancelled: ProviderUserResult(user: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.addScopes(scopes: scopes) { finish(Self.userResult($0, $1, $2)) }
    }
  }
  func silentRestore() throws -> Promise<ProviderUserResult> {
    request(cancelled: ProviderUserResult(user: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.initialize { data, code, detail in
        if data == nil && code == nil { finish(ProviderUserResult(user: nil, failure: nil)) }
        else { finish(Self.userResult(data, code, detail)) }
      }
    }
  }
  func refreshToken() throws -> Promise<ProviderTokenResult> {
    request(cancelled: ProviderTokenResult(tokens: nil, failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.refreshToken { data, code, detail in
        if let failure = Self.failure(code, detail) { finish(ProviderTokenResult(tokens: nil, failure: failure)); return }
        guard let data else { finish(ProviderTokenResult(tokens: nil, failure: ProviderFailure(code: .parseError, detail: nil))); return }
        finish(ProviderTokenResult(tokens: AuthTokens(accessToken: data["accessToken"] as? String,
          idToken: data["idToken"] as? String, refreshToken: data["refreshToken"] as? String,
          expirationTime: (data["expirationTime"] as? NSNumber)?.doubleValue), failure: nil))
      }
    }
  }
  func revokeAccess(provider: AuthProvider) throws -> Promise<ProviderVoidResult> {
    request(cancelled: ProviderVoidResult(failure: ProviderFailure(code: .cancelled, detail: nil))) { finish in
      AuthAdapter.revokeAccess(provider: provider.stringValue) { finish(ProviderVoidResult(failure: Self.failure($0, $1))) }
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

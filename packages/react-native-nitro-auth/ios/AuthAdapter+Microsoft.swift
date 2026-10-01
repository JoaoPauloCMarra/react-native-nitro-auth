import Foundation
import AuthenticationServices
import Security

extension AuthAdapter {
  static func loginMicrosoft(scopes: [String], loginHint: String?, tenant: String?, prompt: String?, operation: AuthAdapter.AuthOperationToken, completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void) {
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }
    let effectiveTenant = tenant ?? Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    let redirectUri = AuthCore.microsoftRedirectUri(bundleId: bundleId)
    let effectiveScopes = scopes.isEmpty ? AuthCore.defaultMicrosoftScopes : scopes
    let effectivePrompt = prompt ?? "select_account"

    guard let codeVerifier = generateCodeVerifier() else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }
    guard let codeChallenge = generateCodeChallenge(codeVerifier) else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }
    let state = UUID().uuidString
    let nonce = UUID().uuidString

    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: effectiveTenant, b2cDomain: b2cDomain) else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }

    guard let authUrl = AuthCore.microsoftAuthorizeUrl(
      authBaseUrl: authBaseUrl,
      clientId: clientId,
      redirectUri: redirectUri,
      scopes: effectiveScopes,
      state: state,
      nonce: nonce,
      codeChallenge: codeChallenge,
      prompt: effectivePrompt,
      loginHint: loginHint
    ) else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }

    let callbackScheme = AuthCore.microsoftCallbackScheme(bundleId: bundleId)

    DispatchQueue.main.async {
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }
      guard self.activeMicrosoftWebAuthSession == nil else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.operationInProgress.rawValue), nil)
        return
      }

      let completeAndClearSession = { (data: NSDictionary?, code: NSNumber?, message: String?) in
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
          return
        }
        self.activeMicrosoftWebAuthSession = nil
        self.activeMicrosoftWebAuthSessionEpoch = nil
        completion(data, code, message)
      }

      let session = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: callbackScheme) { callbackURL, error in
        if let error = error {
          let nsError = error as NSError
          let mapped = AuthCore.mapWebAuthSessionError(
            nsError,
            webAuthSessionErrorDomain: ASWebAuthenticationSessionErrorDomain,
            canceledLoginCode: ASWebAuthenticationSessionError.canceledLogin.rawValue
          )
          completeAndClearSession(nil, NSNumber(value: mapped.rawValue), nsError.localizedDescription)
          return
        }

        let code: String
        switch AuthCore.classifyMicrosoftCallback(callbackURL, expectedState: state) {
        case .failure(let failureCode, let detail):
          completeAndClearSession(nil, NSNumber(value: failureCode.rawValue), detail)
          return
        case .code(let authorizationCode):
          code = authorizationCode
        }

        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
          return
        }
        self.activeMicrosoftWebAuthSession = nil
        self.activeMicrosoftWebAuthSessionEpoch = nil
        exchangeCodeForTokens(
          code: code,
          codeVerifier: codeVerifier,
          clientId: clientId,
          redirectUri: redirectUri,
          tenant: effectiveTenant,
          b2cDomain: b2cDomain,
          expectedNonce: nonce,
          scopes: effectiveScopes,
          operation: operation,
          completion: completion
        )
      }

      guard let window = activeWindow() else {
        completeAndClearSession(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
        return
      }
      let contextProvider = WebAuthContextProvider(anchor: window)
      session.presentationContextProvider = contextProvider
      objc_setAssociatedObject(session, &contextProviderHandle, contextProvider, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      session.prefersEphemeralWebBrowserSession = false
      self.activeMicrosoftWebAuthSession = session
      self.activeMicrosoftWebAuthSessionEpoch = operation.epoch
      if !session.start() {
        completeAndClearSession(nil, NSNumber(value: PlatformAuthErrorCode.unknown.rawValue), nil)
      }
    }
  }

  static func generateCodeVerifier() -> String? {
    AuthCore.generateCodeVerifier { bytes in
      SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess
    }
  }

  static func generateCodeChallenge(_ verifier: String) -> String? {
    AuthCore.generateCodeChallenge(verifier)
  }

  static func formUrlEncodedBody(_ params: [String: String]) -> Data? {
    AuthCore.formUrlEncodedBody(params)
  }

  static func exchangeCodeForTokens(
    code: String,
    codeVerifier: String,
    clientId: String,
    redirectUri: String,
    tenant: String,
    b2cDomain: String?,
    expectedNonce: String,
    scopes: [String],
    operation: AuthAdapter.AuthOperationToken,
    completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void
  ) {
    guard isCurrentOperation(operation) else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
      return
    }
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = AuthCore.microsoftTokenUrl(authBaseUrl: authBaseUrl) else {
      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
          return
        }
        completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      }
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

    request.httpBody = formUrlEncodedBody(bodyParams)

    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
          return
        }
        if let error = error {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.networkError.rawValue), error.localizedDescription)
          return
        }

        let tokens: AuthCore.MicrosoftTokens
        switch AuthCore.parseMicrosoftCodeExchange(
          data: data,
          statusCode: (response as? HTTPURLResponse)?.statusCode,
          expectedNonce: expectedNonce,
          nowSeconds: Date().timeIntervalSince1970,
          decodeJwt: { decodeJwt($0) }
        ) {
        case .failure(let failureCode, let detail):
          completion(nil, NSNumber(value: failureCode.rawValue), detail)
          return
        case .success(let parsed):
          tokens = parsed
        }
        let refreshToken = tokens.refreshToken

        let resultScopes = scopes.isEmpty ? defaultMicrosoftScopes : scopes
        guard self.commitCurrentOperation(operation, {
          if !refreshToken.isEmpty {
            inMemoryMicrosoftRefreshToken = refreshToken
          }
          inMemoryMicrosoftScopes = resultScopes
        }) else {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
          return
        }
        guard self.isCurrentOperation(operation) else {
          completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
          return
        }

        completion(AuthCore.microsoftUserData(tokens, scopes: resultScopes) as NSDictionary, nil, nil)
      }
    }.resume()
  }

  static func decodeJwt(_ token: String) -> [String: String] {
    AuthCore.decodeJwt(token) { NitroAuthJwtPayloadJson($0, $1, $2) }
  }

  static func requestMicrosoftTokenRefresh(
    refreshToken: String,
    operation: AuthAdapter.AuthOperationToken,
    completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void,
    onResponse: @escaping (Data?, URLResponse?, Error?) -> Void
  ) {
    guard isCurrentOperation(operation) else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
      return
    }
    guard let clientId = Bundle.main.object(forInfoDictionaryKey: "MSALClientID") as? String, !clientId.isEmpty else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }
    let tenant = Bundle.main.object(forInfoDictionaryKey: "MSALTenant") as? String ?? "common"
    let b2cDomain = Bundle.main.object(forInfoDictionaryKey: "MSALB2cDomain") as? String
    guard let authBaseUrl = getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain),
          let tokenUrl = AuthCore.microsoftTokenUrl(authBaseUrl: authBaseUrl) else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.configurationError.rawValue), nil)
      return
    }
    var request = URLRequest(url: tokenUrl)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formUrlEncodedBody([
      "client_id": clientId,
      "grant_type": "refresh_token",
      "refresh_token": refreshToken
    ])
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async { onResponse(data, response, error) }
    }.resume()
  }

  static func clearMicrosoftRefreshTokenOnClientError(_ statusCode: Int, operation: AuthAdapter.AuthOperationToken) {
    guard AuthCore.shouldClearMicrosoftRefreshToken(statusCode: statusCode) else { return }
    _ = commitCurrentOperation(operation) {
      inMemoryMicrosoftRefreshToken = nil
    }
  }

  static func tryMicrosoftSilentRefresh(
    completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void,
    operation: AuthAdapter.AuthOperationToken
  ) {
    tokenStoreLock.lock()
    let refreshToken = inMemoryMicrosoftRefreshToken
    let currentScopes = inMemoryMicrosoftScopes
    tokenStoreLock.unlock()
    guard let refreshToken = refreshToken else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.notSignedIn.rawValue), nil)
      return
    }

    requestMicrosoftTokenRefresh(refreshToken: refreshToken, operation: operation, completion: completion) { data, response, error in
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }
      if let error = error {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.networkError.rawValue), error.localizedDescription)
        return
      }
      let statusCode = (response as? HTTPURLResponse)?.statusCode
      if let statusCode = statusCode, !(200...299).contains(statusCode) {
        clearMicrosoftRefreshTokenOnClientError(statusCode, operation: operation)
      }
      let tokens: AuthCore.MicrosoftTokens
      switch AuthCore.parseMicrosoftSilentRefresh(
        data: data,
        statusCode: statusCode,
        nowSeconds: Date().timeIntervalSince1970,
        decodeJwt: { decodeJwt($0) }
      ) {
      case .failure(let failureCode, let detail):
        completion(nil, NSNumber(value: failureCode.rawValue), detail)
        return
      case .success(let parsed):
        tokens = parsed
      }
      let newRefreshToken = tokens.refreshToken

      guard self.commitCurrentOperation(operation, {
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
      }) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }

      completion(AuthCore.microsoftUserData(tokens, scopes: currentScopes) as NSDictionary, nil, nil)
    }
  }

  static func tryMicrosoftRefreshForTokenRefresh(completion: @escaping (NSDictionary?, NSNumber?, String?) -> Void, operation: AuthAdapter.AuthOperationToken) {
    tokenStoreLock.lock()
    let refreshToken = inMemoryMicrosoftRefreshToken
    tokenStoreLock.unlock()
    guard let refreshToken = refreshToken else {
      completion(nil, NSNumber(value: PlatformAuthErrorCode.notSignedIn.rawValue), nil)
      return
    }
    requestMicrosoftTokenRefresh(refreshToken: refreshToken, operation: operation, completion: completion) { data, response, error in
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }
      if let error = error {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.networkError.rawValue), error.localizedDescription)
        return
      }
      if let httpResponse = response as? HTTPURLResponse {
        clearMicrosoftRefreshTokenOnClientError(httpResponse.statusCode, operation: operation)
      }
      let tokens: AuthCore.MicrosoftTokens
      switch AuthCore.parseMicrosoftTokenRefresh(
        data: data,
        statusCode: (response as? HTTPURLResponse)?.statusCode,
        nowSeconds: Date().timeIntervalSince1970
      ) {
      case .failure(let failureCode, let detail):
        completion(nil, NSNumber(value: failureCode.rawValue), detail)
        return
      case .success(let parsed):
        tokens = parsed
      }
      let newRefreshToken = tokens.refreshToken
      guard self.commitCurrentOperation(operation, {
        if !newRefreshToken.isEmpty {
          inMemoryMicrosoftRefreshToken = newRefreshToken
        }
      }) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }
      guard self.isCurrentOperation(operation) else {
        completion(nil, NSNumber(value: PlatformAuthErrorCode.cancelled.rawValue), nil)
        return
      }
      completion(AuthCore.microsoftTokensData(tokens) as NSDictionary, nil, nil)
    }
  }

  static func getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?) -> String? {
    AuthCore.getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: b2cDomain)
  }
}

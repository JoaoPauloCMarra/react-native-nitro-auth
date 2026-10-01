import XCTest
@testable import NitroAuthCore

final class MicrosoftFlowTests: XCTestCase {
  private let now: TimeInterval = 1_789_500_000

  private func json(_ object: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
  }

  private func claims(_ values: [String: String]) -> (String) -> [String: String] {
    { _ in values }
  }

  private func query(_ url: URL) -> [String: String] {
    var result: [String: String] = [:]
    for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
      result[item.name] = item.value
    }
    return result
  }

  func testAuthorityUrlAcceptsDocumentedTenantsAndB2cForms() {
    XCTAssertEqual(AuthCore.getMicrosoftAuthBaseUrl(tenant: " common ", b2cDomain: nil), "https://login.microsoftonline.com/common/")
    XCTAssertEqual(AuthCore.getMicrosoftAuthBaseUrl(tenant: "common", b2cDomain: "  "), "https://login.microsoftonline.com/common/")
    XCTAssertEqual(
      AuthCore.getMicrosoftAuthBaseUrl(tenant: "B2C_1_signin", b2cDomain: " Contoso.B2CLogin.com "),
      "https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_signin/"
    )
    XCTAssertEqual(
      AuthCore.getMicrosoftAuthBaseUrl(tenant: "tenant.onmicrosoft.com/B2C_1_signin", b2cDomain: "login.example.com"),
      "https://login.example.com/tenant.onmicrosoft.com/B2C_1_signin/"
    )
  }

  func testAuthorityUrlRejectsHostileTenantsAndDomains() {
    let tenants = ["", " ", "../evil", "a/b", "evil.com/path?x=1", "tenant#fragment", "user@evil",
                   String(repeating: "t", count: 129), "tenant\nname"]
    for tenant in tenants {
      XCTAssertNil(AuthCore.getMicrosoftAuthBaseUrl(tenant: tenant, b2cDomain: nil), tenant)
    }
    let domains = ["evil.com/path", "user@evil.com", "evil.com#fragment", "127.0.0.1", "localhost",
                   "evil.com:8443", "-evil.com", "evil..com"]
    for domain in domains {
      XCTAssertNil(AuthCore.getMicrosoftAuthBaseUrl(tenant: "tenant.onmicrosoft.com/B2C_1_signin", b2cDomain: domain), domain)
    }
    XCTAssertNil(AuthCore.getMicrosoftAuthBaseUrl(tenant: "B2C_1_signin", b2cDomain: "login.example.com"))
    XCTAssertNil(AuthCore.getMicrosoftAuthBaseUrl(tenant: "a/b/c", b2cDomain: "contoso.b2clogin.com"))
  }

  func testAuthorizeUrlCarriesEveryParameterAndEncodesHostileValues() throws {
    let url = try XCTUnwrap(AuthCore.microsoftAuthorizeUrl(
      authBaseUrl: "https://login.microsoftonline.com/common/",
      clientId: "client&id=1",
      redirectUri: AuthCore.microsoftRedirectUri(bundleId: "com.example.app"),
      scopes: ["openid", "User.Read", "api://x/y z"],
      state: "state+/=&#",
      nonce: "nonce value",
      codeChallenge: "challenge-_",
      prompt: "select_account",
      loginHint: "user+tag@example.com"
    ))

    XCTAssertEqual(url.scheme, "https")
    XCTAssertEqual(url.host, "login.microsoftonline.com")
    XCTAssertEqual(url.path, "/common/oauth2/v2.0/authorize")
    let params = query(url)
    XCTAssertEqual(params, [
      "client_id": "client&id=1",
      "redirect_uri": "msauth.com.example.app://auth",
      "response_type": "code",
      "response_mode": "query",
      "scope": "openid User.Read api://x/y z",
      "state": "state+/=&#",
      "nonce": "nonce value",
      "code_challenge": "challenge-_",
      "code_challenge_method": "S256",
      "prompt": "select_account",
      "login_hint": "user+tag@example.com",
    ])
    XCTAssertFalse(url.absoluteString.contains(" "))
    XCTAssertFalse(url.absoluteString.contains("#"))
    XCTAssertEqual(AuthCore.microsoftCallbackScheme(bundleId: "com.example.app"), "msauth.com.example.app")

    let withoutHint = try XCTUnwrap(AuthCore.microsoftAuthorizeUrl(
      authBaseUrl: "https://login.microsoftonline.com/common/", clientId: "c", redirectUri: "r", scopes: [],
      state: "s", nonce: "n", codeChallenge: "cc", prompt: "none", loginHint: nil
    ))
    XCTAssertNil(query(withoutHint)["login_hint"])
    XCTAssertEqual(query(withoutHint)["scope"], "")
    XCTAssertEqual(
      AuthCore.microsoftTokenUrl(authBaseUrl: "https://login.microsoftonline.com/common/")?.absoluteString,
      "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    )
  }

  func testCallbackIsAcceptedOnlyWithTheExactState() {
    let base = "msauth.com.example.app://auth"
    XCTAssertEqual(AuthCore.classifyMicrosoftCallback(URL(string: "\(base)?code=abc&state=S1"), expectedState: "S1"), .code("abc"))
    XCTAssertEqual(AuthCore.classifyMicrosoftCallback(URL(string: "\(base)?state=S1&code=a%20b%2Bc"), expectedState: "S1"), .code("a b+c"))
    XCTAssertEqual(AuthCore.classifyMicrosoftCallback(nil, expectedState: "S1"), .failure(.unknown, nil))

    let invalidStates = ["\(base)", "\(base)?", "\(base)?code=abc", "\(base)?code=abc&state=", "\(base)?code=abc&state",
                         "\(base)?code=abc&state=s1", "\(base)?code=abc&state=S1%20", "\(base)?code=abc&state=S2",
                         "\(base)?code=abc&STATE=S1", "\(base)?code=abc&state=S1&state=S2", "\(base)#state=S1&code=abc",
                         "\(base)?code=abc&state=\(String(repeating: "S", count: 100_000))"]
    for callback in invalidStates {
      XCTAssertEqual(
        AuthCore.classifyMicrosoftCallback(URL(string: callback), expectedState: "S1"),
        .failure(.invalidState, nil),
        String(callback.prefix(120))
      )
    }
    XCTAssertEqual(
      AuthCore.classifyMicrosoftCallback(URL(string: "\(base)?code=abc&state=S2&state=S1"), expectedState: "S1"),
      .code("abc")
    )
    XCTAssertEqual(AuthCore.classifyMicrosoftCallback(URL(string: "\(base)?code=abc&state="), expectedState: ""), .code("abc"))
  }

  func testCallbackErrorsMapThroughTheSharedTableAndMissingCodeIsATokenError() {
    let base = "msauth.com.example.app://auth?state=S1"
    let cases: [(String, AuthCore.MicrosoftCallback)] = [
      ("error=access_denied&error_description=User%20closed", .failure(.cancelled, "User closed")),
      ("error=access_denied", .failure(.cancelled, "access_denied")),
      ("error=interaction_required", .failure(.interactionRequired, "interaction_required")),
      ("error=invalid_grant", .failure(.tokenError, "invalid_grant")),
      ("error=brand_new_error", .failure(.unknown, "brand_new_error")),
      ("error=", .failure(.unknown, "")),
      ("", .failure(.tokenError, nil)),
    ]
    for (query, expected) in cases {
      let suffix = query.isEmpty ? "" : "&\(query)"
      XCTAssertEqual(AuthCore.classifyMicrosoftCallback(URL(string: "\(base)\(suffix)"), expectedState: "S1"), expected, query)
    }
    XCTAssertEqual(
      AuthCore.classifyMicrosoftCallback(URL(string: "\(base)&error=invalid_grant&code=abc"), expectedState: "S1"),
      .failure(.tokenError, "invalid_grant")
    )
    XCTAssertEqual(
      AuthCore.classifyMicrosoftCallback(URL(string: "\(base)&error=access_denied&error_description="), expectedState: "S1"),
      .failure(.cancelled, "")
    )
    XCTAssertEqual(AuthCore.classifyMicrosoftCallback(URL(string: "\(base)&code"), expectedState: "S1"), .failure(.tokenError, nil))
    XCTAssertEqual(AuthCore.classifyMicrosoftCallback(URL(string: "\(base)&code="), expectedState: "S1"), .code(""))
    XCTAssertEqual(
      AuthCore.classifyMicrosoftCallback(URL(string: "\(base)&error=access_denied"), expectedState: "other"),
      .failure(.invalidState, nil)
    )
  }

  func testFormBodyPercentEncodesEverythingOutsideTheUnreservedSet() throws {
    let params = ["code": "a+b/c=d&e f", "client_id": "id~._-", "redirect_uri": "msauth.com.example://auth", "unicode": "é🚀"]
    let body = try XCTUnwrap(String(data: try XCTUnwrap(AuthCore.formUrlEncodedBody(params)), encoding: .utf8))
    var decoded: [String: String] = [:]
    for pair in body.split(separator: "&") {
      let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      XCTAssertEqual(parts.count, 2)
      decoded[String(parts[0]).removingPercentEncoding ?? ""] = String(parts[1]).removingPercentEncoding
    }
    XCTAssertEqual(decoded, params)
    XCTAssertTrue(body.contains("code=a%2Bb%2Fc%3Dd%26e%20f"))
    XCTAssertTrue(body.contains("client_id=id~._-"))
    XCTAssertTrue(body.contains("redirect_uri=msauth.com.example%3A%2F%2Fauth"))
    XCTAssertTrue(body.contains("unicode=%C3%A9%F0%9F%9A%80"))
    XCTAssertEqual(AuthCore.formUrlEncodedBody([:]), Data())
  }

  func testExpiryMathUsesTheResponseLifetimeOrTheDocumentedDefault() throws {
    func expiry(json text: String, now: TimeInterval? = nil) throws -> Double {
      let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
      return AuthCore.microsoftExpirationTime(expiresIn: object["expires_in"], nowSeconds: now ?? self.now)
    }

    XCTAssertEqual(try expiry(json: "{\"expires_in\":3599}"), 1_789_503_599_000)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":60}"), 1_789_500_060_000)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":0.5}"), 1_789_500_000_500)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":2147483647}"), 1_789_500_000_000 + 2_147_483_647_000)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":4294967296}"), 1_789_500_000_000 + 4_294_967_296_000)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":1}", now: 0), 1000)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":1}", now: 1_789_500_000.123), 1_789_500_001_123, accuracy: 0.001)
    XCTAssertEqual(AuthCore.microsoftExpirationTime(expiresIn: NSNumber(value: 60), nowSeconds: now), 1_789_500_060_000)
    XCTAssertEqual(AuthCore.microsoftExpirationTime(expiresIn: 0.5, nowSeconds: now), 1_789_500_000_500)

    let fallback = 1_789_503_600_000.0
    for text in ["{}", "{\"expires_in\":0}", "{\"expires_in\":-1}", "{\"expires_in\":-3600.5}", "{\"expires_in\":\"3600\"}",
                 "{\"expires_in\":null}", "{\"expires_in\":[3600]}", "{\"expires_in\":true}", "{\"expires_in\":false}",
                 "{\"expires_in\":9223372036854775807}"] {
      XCTAssertEqual(try expiry(json: text), text.contains("true") ? 1_789_500_001_000 : fallback, text)
    }
    for invalid in [nil, NSNull(), "3600", Double.nan, -Double.infinity, 0.0, -0.0] as [Any?] {
      XCTAssertEqual(AuthCore.microsoftExpirationTime(expiresIn: invalid, nowSeconds: now), fallback, "\(String(describing: invalid))")
    }

    XCTAssertEqual(try expiry(json: "{\"expires_in\":1e308}"), .infinity)
    XCTAssertEqual(AuthCore.microsoftExpirationTime(expiresIn: Double.infinity, nowSeconds: now), .infinity)
    XCTAssertEqual(try expiry(json: "{\"expires_in\":1e15}"), 1_789_500_000_000 + 1e18)
  }

  func testGoogleExpiryIsEpochMillisecondsAndZeroWhenTheSdkGivesNoDate() {
    XCTAssertEqual(AuthCore.googleExpirationTime(Date(timeIntervalSince1970: 1_789_500_000)), 1_789_500_000_000)
    XCTAssertEqual(AuthCore.googleExpirationTime(Date(timeIntervalSince1970: 1_789_500_000.5)), 1_789_500_000_500)
    XCTAssertEqual(AuthCore.googleExpirationTime(Date(timeIntervalSince1970: -1)), -1000)
    XCTAssertEqual(AuthCore.googleExpirationTime(nil), 0)
    XCTAssertEqual(AuthCore.googleExpirationTime(Date.distantFuture), Date.distantFuture.timeIntervalSince1970 * 1000)
  }

  func testCodeExchangeResponseMatrix() {
    let tokenJson = json(["id_token": "id", "access_token": "access", "refresh_token": "refresh", "expires_in": 120])
    let matching = claims(["nonce": "N1", "preferred_username": "user@example.com", "name": "User"])

    XCTAssertEqual(
      AuthCore.parseMicrosoftCodeExchange(data: tokenJson, statusCode: 200, expectedNonce: "N1", nowSeconds: now, decodeJwt: matching),
      .success(AuthCore.MicrosoftTokens(
        idToken: "id", accessToken: "access", refreshToken: "refresh", expirationTime: 1_789_500_120_000,
        claims: ["nonce": "N1", "preferred_username": "user@example.com", "name": "User"]
      ))
    )
    XCTAssertEqual(
      AuthCore.parseMicrosoftCodeExchange(data: json(["id_token": "id"]), statusCode: nil, expectedNonce: "N1", nowSeconds: now, decodeJwt: matching),
      .success(AuthCore.MicrosoftTokens(
        idToken: "id", accessToken: "", refreshToken: "", expirationTime: 1_789_503_600_000,
        claims: ["nonce": "N1", "preferred_username": "user@example.com", "name": "User"]
      ))
    )

    func outcome(_ data: Data?, _ status: Int?, nonce: String = "N1") -> AuthCore.MicrosoftTokenOutcome {
      AuthCore.parseMicrosoftCodeExchange(data: data, statusCode: status, expectedNonce: nonce, nowSeconds: now, decodeJwt: matching)
    }
    XCTAssertEqual(outcome(nil, 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(nil, nil), .failure(.parseError, nil))
    XCTAssertEqual(outcome(nil, 500), .failure(.networkError, nil))
    XCTAssertEqual(outcome(Data(), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(Data("not json".utf8), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(Data("[1,2]".utf8), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(Data("<html>".utf8), 502), .failure(.networkError, nil))
    XCTAssertEqual(outcome(Data("{\"id_token\":".utf8), 200), .failure(.parseError, nil))
    XCTAssertEqual(
      outcome(json(["error": "invalid_grant", "error_description": "AADSTS70008"]), 400),
      .failure(.tokenError, "AADSTS70008")
    )
    XCTAssertEqual(outcome(json(["error": "invalid_client"]), 200), .failure(.configurationError, nil))
    XCTAssertEqual(outcome(json(["error": "brand_new", "error_description": 5]), 400), .failure(.unknown, nil))
    XCTAssertEqual(outcome(json(["error": 5, "id_token": "id"]), 400), .failure(.networkError, nil))
    XCTAssertEqual(outcome(json(["id_token": "id"]), 199), .failure(.networkError, nil))
    XCTAssertEqual(outcome(json(["id_token": "id"]), 300), .failure(.networkError, nil))
    XCTAssertEqual(outcome(json([:]), 200), .failure(.noIdToken, nil))
    XCTAssertEqual(outcome(json(["id_token": 5]), 200), .failure(.noIdToken, nil))
    XCTAssertEqual(outcome(json(["id_token": NSNull()]), 200), .failure(.noIdToken, nil))
    XCTAssertEqual(outcome(json(["id_token": "id"]), 200, nonce: "other"), .failure(.invalidNonce, nil))
    XCTAssertEqual(outcome(json(["id_token": "id"]), 200, nonce: "n1"), .failure(.invalidNonce, nil))
    XCTAssertEqual(
      AuthCore.parseMicrosoftCodeExchange(data: json(["id_token": ""]), statusCode: 200, expectedNonce: "N1", nowSeconds: now, decodeJwt: claims([:])),
      .failure(.invalidNonce, nil)
    )
    XCTAssertEqual(outcome(json(["id_token": "id", "access_token": 5, "refresh_token": NSNull(), "expires_in": "soon"]), 200),
      .success(AuthCore.MicrosoftTokens(
        idToken: "id", accessToken: "", refreshToken: "", expirationTime: 1_789_503_600_000,
        claims: ["nonce": "N1", "preferred_username": "user@example.com", "name": "User"]
      ))
    )
  }

  func testSilentRefreshResponseMatrix() {
    let decoded = claims(["email": "user@example.com"])
    func outcome(_ data: Data?, _ status: Int?) -> AuthCore.MicrosoftTokenOutcome {
      AuthCore.parseMicrosoftSilentRefresh(data: data, statusCode: status, nowSeconds: now, decodeJwt: decoded)
    }
    XCTAssertEqual(
      outcome(json(["id_token": "id", "access_token": "access", "refresh_token": "rotated", "expires_in": 1]), 200),
      .success(AuthCore.MicrosoftTokens(
        idToken: "id", accessToken: "access", refreshToken: "rotated", expirationTime: 1_789_500_001_000,
        claims: ["email": "user@example.com"]
      ))
    )
    XCTAssertEqual(outcome(json(["error": "invalid_grant", "error_description": "expired"]), 400), .failure(.refreshFailed, "expired"))
    XCTAssertEqual(outcome(json(["error": "interaction_required"]), 400), .failure(.interactionRequired, nil))
    XCTAssertEqual(outcome(json(["error": "temporarily_unavailable"]), 503), .failure(.networkError, nil))
    XCTAssertEqual(outcome(json(["id_token": "id"]), 500), .failure(.networkError, nil))
    XCTAssertEqual(outcome(nil, 429), .failure(.networkError, nil))
    XCTAssertEqual(outcome(Data("oops".utf8), 408), .failure(.networkError, nil))
    XCTAssertEqual(outcome(nil, 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(nil, nil), .failure(.parseError, nil))
    XCTAssertEqual(outcome(Data("oops".utf8), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(json(["access_token": "access"]), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(json(["id_token": 1]), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(json(["error": "invalid_grant", "id_token": "id"]), 200),
      .success(AuthCore.MicrosoftTokens(
        idToken: "id", accessToken: "", refreshToken: "", expirationTime: 1_789_503_600_000, claims: ["email": "user@example.com"]
      ))
    )
  }

  func testTokenRefreshResponseMatrix() {
    func outcome(_ data: Data?, _ status: Int?) -> AuthCore.MicrosoftTokenOutcome {
      AuthCore.parseMicrosoftTokenRefresh(data: data, statusCode: status, nowSeconds: now)
    }
    XCTAssertEqual(
      outcome(json(["id_token": "id", "access_token": "access", "refresh_token": "rotated", "expires_in": 7200]), 200),
      .success(AuthCore.MicrosoftTokens(
        idToken: "id", accessToken: "access", refreshToken: "rotated", expirationTime: 1_789_507_200_000, claims: [:]
      ))
    )
    XCTAssertEqual(
      outcome(json([:]), 200),
      .success(AuthCore.MicrosoftTokens(idToken: "", accessToken: "", refreshToken: "", expirationTime: 1_789_503_600_000, claims: [:]))
    )
    XCTAssertEqual(outcome(json(["error": "invalid_grant", "error_description": "revoked"]), 400), .failure(.refreshFailed, "revoked"))
    XCTAssertEqual(outcome(json(["error": "invalid_grant"]), 200), .failure(.refreshFailed, nil))
    XCTAssertEqual(outcome(json(["error": "invalid_token"]), 401), .failure(.refreshFailed, nil))
    XCTAssertEqual(outcome(json(["error": "server_error"]), 500), .failure(.networkError, nil))
    XCTAssertEqual(outcome(json(["access_token": "access"]), 500), .failure(.networkError, nil))
    XCTAssertEqual(outcome(nil, 500), .failure(.networkError, nil))
    XCTAssertEqual(outcome(Data("oops".utf8), 429), .failure(.networkError, nil))
    XCTAssertEqual(outcome(nil, 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(nil, nil), .failure(.parseError, nil))
    XCTAssertEqual(outcome(Data("oops".utf8), 200), .failure(.parseError, nil))
    XCTAssertEqual(outcome(Data("\"text\"".utf8), 200), .failure(.parseError, nil))
  }

  func testResultPayloadsPreferTheUsernameClaimAndKeepEmptyStringsForTheBridge() {
    let tokens = AuthCore.MicrosoftTokens(
      idToken: "id", accessToken: "access", refreshToken: "refresh", expirationTime: 5,
      claims: ["preferred_username": "upn@example.com", "email": "mail@example.com", "name": "User"]
    )
    let user = AuthCore.microsoftUserData(tokens, scopes: ["openid"])
    XCTAssertEqual(user["provider"] as? String, "microsoft")
    XCTAssertEqual(user["email"] as? String, "upn@example.com")
    XCTAssertEqual(user["name"] as? String, "User")
    XCTAssertEqual(user["photo"] as? String, "")
    XCTAssertEqual(user["idToken"] as? String, "id")
    XCTAssertEqual(user["accessToken"] as? String, "access")
    XCTAssertEqual(user["serverAuthCode"] as? String, "")
    XCTAssertEqual(user["scopes"] as? [String], ["openid"])
    XCTAssertEqual(user["expirationTime"] as? Double, 5)
    XCTAssertNil(user["refreshToken"])
    XCTAssertEqual(Set(user.keys), ["provider", "email", "name", "photo", "idToken", "accessToken", "serverAuthCode", "scopes", "expirationTime"])

    let emailOnly = AuthCore.MicrosoftTokens(idToken: "id", accessToken: "", refreshToken: "", expirationTime: 5, claims: ["email": "mail@example.com"])
    XCTAssertEqual(AuthCore.microsoftUserData(emailOnly, scopes: [])["email"] as? String, "mail@example.com")
    XCTAssertEqual(AuthCore.microsoftUserData(emailOnly, scopes: [])["name"] as? String, "")
    let emptyUsername = AuthCore.MicrosoftTokens(
      idToken: "id", accessToken: "", refreshToken: "", expirationTime: 5,
      claims: ["preferred_username": "", "email": "mail@example.com"]
    )
    XCTAssertEqual(AuthCore.microsoftUserData(emptyUsername, scopes: [])["email"] as? String, "mail@example.com")
    let bothEmpty = AuthCore.MicrosoftTokens(
      idToken: "id", accessToken: "", refreshToken: "", expirationTime: 5, claims: ["preferred_username": "", "email": ""]
    )
    XCTAssertEqual(AuthCore.microsoftUserData(bothEmpty, scopes: [])["email"] as? String, "")
    let none = AuthCore.MicrosoftTokens(idToken: "id", accessToken: "", refreshToken: "", expirationTime: 5, claims: [:])
    XCTAssertEqual(AuthCore.microsoftUserData(none, scopes: [])["email"] as? String, "")

    let refreshed = AuthCore.microsoftTokensData(tokens)
    XCTAssertEqual(refreshed["accessToken"] as? String, "access")
    XCTAssertEqual(refreshed["idToken"] as? String, "id")
    XCTAssertEqual(refreshed["expirationTime"] as? Double, 5)
    XCTAssertEqual(Set(refreshed.keys), ["accessToken", "idToken", "expirationTime"])
  }

  func testScopeMergeKeepsFirstOccurrenceOrder() {
    XCTAssertEqual(AuthCore.mergedScopes(["openid", "email"], adding: ["email", "User.Read", "openid", "User.Read"]), ["openid", "email", "User.Read"])
    XCTAssertEqual(AuthCore.mergedScopes([], adding: []), [])
    XCTAssertEqual(AuthCore.mergedScopes(["a", "a"], adding: ["A", ""]), ["a", "A", ""])
    XCTAssertEqual(AuthCore.defaultMicrosoftScopes, ["openid", "email", "profile", "offline_access", "User.Read"])
  }

  func testBridgeFieldMappingTurnsEmptyStringsIntoNilAndRejectsWrongTypes() {
    XCTAssertNil(AuthCore.text(nil))
    XCTAssertNil(AuthCore.text(""))
    XCTAssertNil(AuthCore.text(NSNull()))
    XCTAssertNil(AuthCore.text(5))
    XCTAssertNil(AuthCore.text(["a"]))
    XCTAssertEqual(AuthCore.text(" "), " ")
    XCTAssertEqual(AuthCore.text("value"), "value")
    XCTAssertEqual(AuthCore.text("value" as NSString), "value")

    XCTAssertTrue(AuthCore.hasValidUserFieldTypes([:]))
    XCTAssertTrue(AuthCore.hasValidUserFieldTypes(["email": "", "name": NSNull(), "scopes": NSNull(), "expirationTime": NSNull()]))
    XCTAssertTrue(AuthCore.hasValidUserFieldTypes(["email": "a@b.c", "scopes": ["openid"], "expirationTime": 1.5, "extra": 7]))
    XCTAssertTrue(AuthCore.hasValidUserFieldTypes(["scopes": [String](), "expirationTime": NSNumber(value: 5)]))
    for field in AuthCore.userStringFields {
      XCTAssertFalse(AuthCore.hasValidUserFieldTypes([field: 5]), field)
      XCTAssertFalse(AuthCore.hasValidUserFieldTypes([field: ["nested"]]), field)
    }
    XCTAssertFalse(AuthCore.hasValidUserFieldTypes(["scopes": "openid"]))
    XCTAssertFalse(AuthCore.hasValidUserFieldTypes(["scopes": [1, 2]]))
    XCTAssertFalse(AuthCore.hasValidUserFieldTypes(["scopes": ["openid", 2]]))
    XCTAssertFalse(AuthCore.hasValidUserFieldTypes(["expirationTime": "1789500000000"]))
    XCTAssertFalse(AuthCore.hasValidUserFieldTypes(["expirationTime": Date()]))

    XCTAssertNil(AuthCore.expirationTime(nil))
    XCTAssertNil(AuthCore.expirationTime(NSNull()))
    XCTAssertNil(AuthCore.expirationTime("5"))
    XCTAssertEqual(AuthCore.expirationTime(1_789_500_000_000.0), 1_789_500_000_000)
    XCTAssertEqual(AuthCore.expirationTime(NSNumber(value: Int64.max)), 9.223372036854776e18)
    XCTAssertEqual(AuthCore.expirationTime(0), 0)
    XCTAssertEqual(AuthCore.expirationTime(-1), -1)
    XCTAssertTrue(AuthCore.expirationTime(Double.nan)?.isNaN ?? false)
  }
}

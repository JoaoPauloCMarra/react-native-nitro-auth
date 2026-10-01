import XCTest
@testable import NitroAuthCore

final class ErrorMappingTests: XCTestCase {
  private let wireNames: [(PlatformAuthErrorCode, String)] = [
    (.refreshFailed, "refresh_failed"), (.cancelled, "cancelled"), (.interactionRequired, "interaction_required"),
    (.timeout, "timeout"), (.popupBlocked, "popup_blocked"), (.networkError, "network_error"),
    (.configurationError, "configuration_error"), (.notSignedIn, "not_signed_in"),
    (.operationInProgress, "operation_in_progress"), (.unsupportedProvider, "unsupported_provider"),
    (.invalidState, "invalid_state"), (.invalidNonce, "invalid_nonce"), (.tokenError, "token_error"),
    (.noIdToken, "no_id_token"), (.parseError, "parse_error"), (.unknown, "unknown"),
  ]

  private let appleDomain = "com.apple.AuthenticationServices.AuthorizationError"

  private func mapProvider(_ error: NSError) -> PlatformAuthErrorCode {
    AuthCore.mapProviderError(error, appleErrorDomain: appleDomain, appleCanceledCode: 1001, appleInvalidResponseCode: 1002)
  }

  private func oauthErrorSource() throws -> [String: String] {
    let url = URL(fileURLWithPath: #filePath)
      .resolvingSymlinksInPath()
      .deletingLastPathComponent()
      .appendingPathComponent("../../../scripts/oauth-errors.json")
      .standardizedFileURL
    let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
    return try XCTUnwrap(json as? [String: String])
  }

  func testCodesAreDenseAndMirrorTheGeneratedNitroEnumOrder() {
    XCTAssertEqual(wireNames.map { $0.0.rawValue }, Array(0...15))
    for value in 0...15 {
      XCTAssertEqual(PlatformAuthErrorCode.fromRawValue(value).rawValue, value)
    }
    for value in [-1, 16, 17, 255, Int.max, Int.min] {
      XCTAssertEqual(PlatformAuthErrorCode.fromRawValue(value), .unknown)
    }
  }

  func testGeneratedOAuthTableMatchesTheSharedJsonSource() throws {
    let source = try oauthErrorSource()
    let names = Dictionary(uniqueKeysWithValues: wireNames.map { ($0.0, $0.1) })
    XCTAssertFalse(source.isEmpty)
    XCTAssertEqual(oauthErrorCodes.mapValues { names[$0] ?? "" }, source)
  }

  func testEveryTableEntryMapsToItsCodeInEveryContext() {
    for (providerError, code) in oauthErrorCodes {
      XCTAssertEqual(AuthCore.mapOAuthError(providerError), code)
      XCTAssertEqual(AuthCore.mapOAuthError(providerError, context: "token"), code)
      XCTAssertEqual(AuthCore.mapOAuthError("  \(providerError.uppercased())\n"), code)
      let refreshCode: PlatformAuthErrorCode = code == .tokenError ? .refreshFailed : code
      XCTAssertEqual(AuthCore.mapOAuthError(providerError, context: "refresh"), refreshCode)
    }
  }

  func testUnknownEmptyAndHostileProviderErrorsMapToUnknown() {
    let hostile = ["", " ", "not_a_real_error", "invalid_grant extra", "invalid_grant\u{0}",
                   String(repeating: "x", count: 1_000_000), "\u{1F680}"]
    for value in hostile {
      XCTAssertEqual(AuthCore.mapOAuthError(value), .unknown)
      XCTAssertEqual(AuthCore.mapOAuthError(value, context: "refresh"), .unknown)
    }
  }

  func testRefreshTokenIsClearedOnlyForTerminalClientErrors() {
    for code in [400, 401, 403, 404, 499] {
      XCTAssertTrue(AuthCore.shouldClearMicrosoftRefreshToken(statusCode: code), "\(code)")
    }
    for code in [Int.min, -1, 0, 200, 302, 399, 408, 429, 500, 503, Int.max] {
      XCTAssertFalse(AuthCore.shouldClearMicrosoftRefreshToken(statusCode: code), "\(code)")
    }
  }

  func testOnlyTheWebAuthSessionCancelCodeInItsOwnDomainIsCancelled() {
    let sessionDomain = "com.apple.AuthenticationServices.WebAuthenticationSession"
    func map(_ domain: String, _ code: Int) -> PlatformAuthErrorCode {
      AuthCore.mapWebAuthSessionError(
        NSError(domain: domain, code: code),
        webAuthSessionErrorDomain: sessionDomain,
        canceledLoginCode: 1
      )
    }
    XCTAssertEqual(map(sessionDomain, 1), .cancelled)
    XCTAssertEqual(map(sessionDomain, 2), .unknown)
    XCTAssertEqual(map(sessionDomain, 3), .unknown)
    XCTAssertEqual(map(sessionDomain, 0), .unknown)

    XCTAssertEqual(map(NSCocoaErrorDomain, 1), .unknown)
    XCTAssertEqual(map(NSPOSIXErrorDomain, 1), .unknown)
    XCTAssertEqual(map("com.apple.AuthenticationServices.AuthorizationError", 1), .unknown)
    XCTAssertEqual(map("", 1), .unknown)
    XCTAssertEqual(map(sessionDomain.uppercased(), 1), .unknown)
    XCTAssertEqual(map("kCFErrorDomainCFNetwork", 1), .networkError)
    XCTAssertEqual(map(NSURLErrorDomain, 1), .unknown)

    XCTAssertEqual(map(NSURLErrorDomain, NSURLErrorNotConnectedToInternet), .networkError)
    XCTAssertEqual(map("kCFErrorDomainCFNetwork", 310), .networkError)
    XCTAssertEqual(map("Custom.NETWORK.Domain", 9), .networkError)
    XCTAssertEqual(map(NSURLErrorDomain, NSURLErrorTimedOut), .unknown)
    XCTAssertEqual(map("", 0), .unknown)
  }

  func testProviderErrorsMapByDomainBeforeMessageHeuristics() {
    XCTAssertEqual(mapProvider(NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)), .networkError)
    XCTAssertEqual(mapProvider(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)), .networkError)
    XCTAssertEqual(mapProvider(NSError(domain: "com.google.GIDSignIn", code: -5)), .cancelled)
    XCTAssertEqual(mapProvider(NSError(domain: "com.google.GIDSignIn", code: -4)), .notSignedIn)
    XCTAssertEqual(mapProvider(NSError(domain: appleDomain, code: 1001)), .cancelled)
    XCTAssertEqual(mapProvider(NSError(domain: appleDomain, code: 1002)), .configurationError)
    for code in [1000, 1003, 1004, 1005, 0, -1] {
      XCTAssertEqual(mapProvider(NSError(domain: appleDomain, code: code)), .unknown, "\(code)")
    }
    XCTAssertEqual(
      mapProvider(NSError(domain: appleDomain, code: 1000, userInfo: [NSLocalizedDescriptionKey: "The user cancelled"])),
      .unknown
    )
  }

  func testProviderErrorMessageHeuristicsAreTheLastResort() {
    func described(_ message: String, domain: String = "com.google.GIDSignIn", code: Int = -1) -> NSError {
      NSError(domain: domain, code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }
    XCTAssertEqual(mapProvider(described("The user CANCELED the sign-in flow.")), .cancelled)
    XCTAssertEqual(mapProvider(described("A Network error occurred")), .networkError)
    XCTAssertEqual(mapProvider(described("No internet connection")), .networkError)
    XCTAssertEqual(mapProvider(described("Device is OFFLINE")), .networkError)
    XCTAssertEqual(mapProvider(described("keychain error")), .unknown)
    XCTAssertEqual(mapProvider(described("", domain: "Other", code: 0)), .unknown)
    XCTAssertEqual(mapProvider(described(String(repeating: "x", count: 1_000_000), domain: "Other")), .unknown)
  }
}

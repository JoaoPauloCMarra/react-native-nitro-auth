import XCTest
@testable import NitroAuthCore

final class AppleScopeTests: XCTestCase {
  func testOmittedAppleScopesKeepTheProfileScopeDefault() {
    XCTAssertEqual(
      AuthCore.effectiveLoginScopes(provider: "apple", scopes: nil),
      ["fullName", "email"]
    )
  }

  func testExplicitEmptyScopesAndExistingAppleNamesArePreserved() {
    let emptyScopes = AuthCore.effectiveLoginScopes(provider: "apple", scopes: [])
    XCTAssertEqual(emptyScopes, [])
    XCTAssertEqual(AuthCore.appleRequestedScopes(emptyScopes), [])
    XCTAssertEqual(
      AuthCore.appleRequestedScopes(["email", "fullName", "name"]),
      [.email, .fullName, .fullName]
    )
  }

  func testOtherProvidersKeepEmptyScopesWhenOmittedOrExplicitlyEmpty() {
    for provider in ["google", "microsoft"] {
      XCTAssertEqual(AuthCore.effectiveLoginScopes(provider: provider, scopes: nil), [], provider)
      XCTAssertEqual(AuthCore.effectiveLoginScopes(provider: provider, scopes: []), [], provider)
    }
  }
}

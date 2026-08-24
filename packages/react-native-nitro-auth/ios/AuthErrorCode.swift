import Foundation

/**
 * Mirror of the generated C++ `AuthErrorCode` enum
 * (nitrogen/generated/shared/c++/AuthErrorCode.hpp). The raw integer value is
 * the wire value passed to `PlatformAuth+iOS.mm`; both must stay aligned with
 * the generated enum.
 */
enum AuthErrorCode: Int {
    case refreshFailed = 0
    case cancelled = 1
    case interactionRequired = 2
    case timeout = 3
    case popupBlocked = 4
    case networkError = 5
    case configurationError = 6
    case notSignedIn = 7
    case operationInProgress = 8
    case unsupportedProvider = 9
    case invalidState = 10
    case invalidNonce = 11
    case tokenError = 12
    case noIdToken = 13
    case parseError = 14
    case unknown = 15

    static func fromRawValue(_ value: Int) -> AuthErrorCode {
        return AuthErrorCode(rawValue: value) ?? .unknown
    }
}

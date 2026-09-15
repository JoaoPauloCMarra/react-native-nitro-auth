import Foundation

// Provider SDK error mapping. HybridNativeAuthAdapter converts to the generated enum.
enum PlatformAuthErrorCode: Int {
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

    static func fromRawValue(_ value: Int) -> PlatformAuthErrorCode {
        return PlatformAuthErrorCode(rawValue: value) ?? .unknown
    }
}

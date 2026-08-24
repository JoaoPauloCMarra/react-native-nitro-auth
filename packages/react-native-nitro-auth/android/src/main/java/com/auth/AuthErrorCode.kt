package com.auth

/**
 * Mirror of the generated C++ `AuthErrorCode` enum
 * (nitrogen/generated/shared/c++/AuthErrorCode.hpp). The integer `code` is the
 * wire value passed across JNI/FFI boundaries; `wire` is the JavaScript union
 * string. Both must stay aligned with the generated enum.
 */
internal enum class AuthErrorCode(val code: Int, val wire: String) {
    REFRESH_FAILED(0, "refresh_failed"),
    CANCELLED(1, "cancelled"),
    INTERACTION_REQUIRED(2, "interaction_required"),
    TIMEOUT(3, "timeout"),
    POPUP_BLOCKED(4, "popup_blocked"),
    NETWORK_ERROR(5, "network_error"),
    CONFIGURATION_ERROR(6, "configuration_error"),
    NOT_SIGNED_IN(7, "not_signed_in"),
    OPERATION_IN_PROGRESS(8, "operation_in_progress"),
    UNSUPPORTED_PROVIDER(9, "unsupported_provider"),
    INVALID_STATE(10, "invalid_state"),
    INVALID_NONCE(11, "invalid_nonce"),
    TOKEN_ERROR(12, "token_error"),
    NO_ID_TOKEN(13, "no_id_token"),
    PARSE_ERROR(14, "parse_error"),
    UNKNOWN(15, "unknown");

    companion object {
        fun fromCode(value: Int): AuthErrorCode = entries.firstOrNull { it.code == value } ?: UNKNOWN
    }
}

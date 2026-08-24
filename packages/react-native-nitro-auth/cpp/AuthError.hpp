#pragma once

#include "AuthErrorCode.hpp"
#include <exception>
#include <optional>
#include <stdexcept>
#include <string>

namespace margelo::nitro::NitroAuth {

inline const char* authErrorCodeName(AuthErrorCode code) {
  switch (code) {
    case AuthErrorCode::REFRESH_FAILED: return "refresh_failed";
    case AuthErrorCode::CANCELLED: return "cancelled";
    case AuthErrorCode::INTERACTION_REQUIRED: return "interaction_required";
    case AuthErrorCode::TIMEOUT: return "timeout";
    case AuthErrorCode::POPUP_BLOCKED: return "popup_blocked";
    case AuthErrorCode::NETWORK_ERROR: return "network_error";
    case AuthErrorCode::CONFIGURATION_ERROR: return "configuration_error";
    case AuthErrorCode::NOT_SIGNED_IN: return "not_signed_in";
    case AuthErrorCode::OPERATION_IN_PROGRESS: return "operation_in_progress";
    case AuthErrorCode::UNSUPPORTED_PROVIDER: return "unsupported_provider";
    case AuthErrorCode::INVALID_STATE: return "invalid_state";
    case AuthErrorCode::INVALID_NONCE: return "invalid_nonce";
    case AuthErrorCode::TOKEN_ERROR: return "token_error";
    case AuthErrorCode::NO_ID_TOKEN: return "no_id_token";
    case AuthErrorCode::PARSE_ERROR: return "parse_error";
    case AuthErrorCode::UNKNOWN: return "unknown";
  }
  return "unknown";
}

inline AuthErrorCode authErrorCodeFromInt(int value) {
  switch (value) {
    case static_cast<int>(AuthErrorCode::REFRESH_FAILED): return AuthErrorCode::REFRESH_FAILED;
    case static_cast<int>(AuthErrorCode::CANCELLED): return AuthErrorCode::CANCELLED;
    case static_cast<int>(AuthErrorCode::INTERACTION_REQUIRED): return AuthErrorCode::INTERACTION_REQUIRED;
    case static_cast<int>(AuthErrorCode::TIMEOUT): return AuthErrorCode::TIMEOUT;
    case static_cast<int>(AuthErrorCode::POPUP_BLOCKED): return AuthErrorCode::POPUP_BLOCKED;
    case static_cast<int>(AuthErrorCode::NETWORK_ERROR): return AuthErrorCode::NETWORK_ERROR;
    case static_cast<int>(AuthErrorCode::CONFIGURATION_ERROR): return AuthErrorCode::CONFIGURATION_ERROR;
    case static_cast<int>(AuthErrorCode::NOT_SIGNED_IN): return AuthErrorCode::NOT_SIGNED_IN;
    case static_cast<int>(AuthErrorCode::OPERATION_IN_PROGRESS): return AuthErrorCode::OPERATION_IN_PROGRESS;
    case static_cast<int>(AuthErrorCode::UNSUPPORTED_PROVIDER): return AuthErrorCode::UNSUPPORTED_PROVIDER;
    case static_cast<int>(AuthErrorCode::INVALID_STATE): return AuthErrorCode::INVALID_STATE;
    case static_cast<int>(AuthErrorCode::INVALID_NONCE): return AuthErrorCode::INVALID_NONCE;
    case static_cast<int>(AuthErrorCode::TOKEN_ERROR): return AuthErrorCode::TOKEN_ERROR;
    case static_cast<int>(AuthErrorCode::NO_ID_TOKEN): return AuthErrorCode::NO_ID_TOKEN;
    case static_cast<int>(AuthErrorCode::PARSE_ERROR): return AuthErrorCode::PARSE_ERROR;
    case static_cast<int>(AuthErrorCode::UNKNOWN): return AuthErrorCode::UNKNOWN;
    default: return AuthErrorCode::UNKNOWN;
  }
}

/**
 * The single formatter for the JS-visible error message: the stable code
 * string, plus the raw platform detail after `": "` when present. Byte-identical
 * to the envelope JavaScript parses today (see `src/utils/auth-error.ts`).
 */
inline std::string formatAuthErrorEnvelope(AuthErrorCode code, const std::optional<std::string>& detail) {
  const char* name = authErrorCodeName(code);
  if (!detail.has_value() || detail->empty()) {
    return std::string(name);
  }
  return std::string(name) + ": " + *detail;
}

/**
 * Structured auth failure carrying the typed `AuthErrorCode` across native
 * boundaries. The JS-visible message is still the `"code: message"` envelope
 * JavaScript parses; the typed code removes string-prefix parsing from native
 * control flow.
 */
class AuthException : public std::runtime_error {
public:
  explicit AuthException(AuthErrorCode code)
    : std::runtime_error(authErrorCodeName(code)), _code(code) {}
  AuthException(AuthErrorCode code, const std::string& message)
    : std::runtime_error(message), _code(code) {}
  AuthErrorCode code() const noexcept { return _code; }

private:
  AuthErrorCode _code;
};

inline std::exception_ptr makeAuthError(AuthErrorCode code, const std::optional<std::string>& detail = std::nullopt) {
  return std::make_exception_ptr(AuthException(code, formatAuthErrorEnvelope(code, detail)));
}

} // namespace margelo::nitro::NitroAuth

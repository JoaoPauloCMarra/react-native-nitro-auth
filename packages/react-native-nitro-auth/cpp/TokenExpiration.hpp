#pragma once

#include "AuthError.hpp"
#include <cmath>
#include <optional>

namespace margelo::nitro::NitroAuth {

inline void validateExpiration(const std::optional<double>& expiration) {
  if (expiration && (!std::isfinite(*expiration) || *expiration < 0)) {
    throw AuthException(AuthErrorCode::PARSE_ERROR);
  }
}

}

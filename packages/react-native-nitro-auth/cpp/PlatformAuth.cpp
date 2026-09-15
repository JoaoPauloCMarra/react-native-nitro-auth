#include "PlatformAuth.hpp"
#include "AuthError.hpp"
#include "HybridNativeAuthAdapterSpec.hpp"
#include <NitroModules/HybridObjectRegistry.hpp>
#include <cmath>
#include <mutex>
#include <type_traits>

namespace margelo::nitro::NitroAuth {
namespace {
std::shared_ptr<HybridNativeAuthAdapterSpec> adapter() {
  static std::mutex mutex;
  static std::shared_ptr<HybridNativeAuthAdapterSpec> instance;
  std::lock_guard<std::mutex> lock(mutex);
  if (!instance) {
    instance = std::dynamic_pointer_cast<HybridNativeAuthAdapterSpec>(HybridObjectRegistry::createHybridObject("NativeAuthAdapter"));
    if (!instance) throw AuthException(AuthErrorCode::CONFIGURATION_ERROR);
  }
  return instance;
}

void validateFailure(const std::optional<ProviderFailure>& failure) {
  if (failure) std::rethrow_exception(makeAuthError(failure->code, failure->detail));
}

void validateExpiration(const std::optional<double>& expiration) {
  if (expiration && (!std::isfinite(*expiration) || *expiration < 0 || std::floor(*expiration) != *expiration)) {
    throw AuthException(AuthErrorCode::PARSE_ERROR);
  }
}

template <typename T, typename Start, typename Convert>
std::shared_ptr<Promise<T>> invoke(Start start, Convert convert) {
  auto result = Promise<T>::create();
  try {
    auto pending = start(*adapter());
    pending->addOnResolvedListener([result, convert](const auto& value) {
      if (!result->isPending()) return;
      try {
        if constexpr (std::is_void_v<T>) { convert(value); result->resolve(); }
        else result->resolve(convert(value));
      } catch (...) { if (result->isPending()) result->reject(std::current_exception()); }
    });
    pending->addOnRejectedListener([result](const std::exception_ptr&) {
      if (result->isPending()) result->reject(makeAuthError(AuthErrorCode::UNKNOWN));
    });
  } catch (const AuthException&) { result->reject(std::current_exception()); }
  catch (...) { result->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR)); }
  return result;
}

AuthUser requireUser(const ProviderUserResult& result) {
  if (result.user && result.failure) throw AuthException(AuthErrorCode::PARSE_ERROR);
  validateFailure(result.failure);
  if (!result.user) throw AuthException(AuthErrorCode::PARSE_ERROR);
  validateExpiration(result.user->expirationTime);
  return *result.user;
}
}

std::shared_ptr<Promise<AuthNonce>> PlatformAuth::createNonce() {
  auto result = Promise<AuthNonce>::create();
  try { result->resolve(adapter()->createNonce()); }
  catch (...) { result->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR)); }
  return result;
}
std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
  return invoke<AuthUser>([&](auto& platform) { return platform.login(provider, options); }, requireUser);
}
std::shared_ptr<Promise<AuthUser>> PlatformAuth::requestScopes(const std::vector<std::string>& scopes) {
  return invoke<AuthUser>([&](auto& platform) { return platform.requestScopes(scopes); }, requireUser);
}
std::shared_ptr<Promise<AuthTokens>> PlatformAuth::refreshToken() {
  return invoke<AuthTokens>([](auto& platform) { return platform.refreshToken(); }, [](const ProviderTokenResult& result) {
    if (result.tokens && result.failure) throw AuthException(AuthErrorCode::PARSE_ERROR);
    validateFailure(result.failure);
    if (!result.tokens) throw AuthException(AuthErrorCode::PARSE_ERROR);
    validateExpiration(result.tokens->expirationTime);
    return *result.tokens;
  });
}
std::shared_ptr<Promise<std::optional<AuthUser>>> PlatformAuth::silentRestore() {
  return invoke<std::optional<AuthUser>>([](auto& platform) { return platform.silentRestore(); }, [](const ProviderUserResult& result) {
    if (result.user && result.failure) throw AuthException(AuthErrorCode::PARSE_ERROR);
    if (result.failure && result.failure->code == AuthErrorCode::NOT_SIGNED_IN) return std::optional<AuthUser>{};
    validateFailure(result.failure);
    if (result.user) validateExpiration(result.user->expirationTime);
    return result.user;
  });
}
std::shared_ptr<Promise<void>> PlatformAuth::revokeAccess(AuthProvider provider) {
  return invoke<void>([&](auto& platform) { return platform.revokeAccess(provider); }, [](const ProviderVoidResult& result) { validateFailure(result.failure); });
}
bool PlatformAuth::hasPlayServices() { return adapter()->hasPlayServices(); }
void PlatformAuth::invalidatePendingOperations() { adapter()->invalidatePendingOperations(); }
void PlatformAuth::cancelPendingOperations(AuthErrorCode) { adapter()->cancel(); }
void PlatformAuth::logout() { adapter()->logout(); }
}

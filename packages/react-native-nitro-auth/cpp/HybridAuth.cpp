#include "HybridAuth.hpp"
#include "PlatformAuth.hpp"
#include "AuthError.hpp"
#include <NitroModules/NitroHash.hpp>
#include <algorithm>
#include <chrono>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <unordered_set>

#if defined(__ANDROID__)
#include <android/log.h>
#endif

namespace margelo::nitro::NitroAuth {

namespace {

std::exception_ptr makeRawAuthError(AuthErrorCode code, const char* message) {
  return std::make_exception_ptr(AuthException(code, message));
}

std::optional<AuthErrorCode> errorCodeOf(const std::exception_ptr& error) {
  if (!error) {
    return std::nullopt;
  }
  try {
    std::rethrow_exception(error);
  } catch (const AuthException& e) {
    return e.code();
  } catch (...) {
    return AuthErrorCode::UNKNOWN;
  }
}

void rejectIfPending(const std::shared_ptr<Promise<AuthTokens>>& promise, AuthErrorCode code) {
  if (promise && promise->isPending()) {
    promise->reject(makeAuthError(code));
  }
}

void rejectIfPending(const std::shared_ptr<Promise<void>>& promise, AuthErrorCode code) {
  if (promise && promise->isPending()) {
    promise->reject(makeAuthError(code));
  }
}

void rejectIfPending(const std::shared_ptr<Promise<void>>& promise, std::exception_ptr error) {
  if (promise && promise->isPending()) {
    promise->reject(std::move(error));
  }
}

void resolveIfPending(const std::shared_ptr<Promise<void>>& promise) {
  if (promise && promise->isPending()) {
    promise->resolve();
  }
}

void rejectPendingSessionPromises(const std::vector<std::shared_ptr<Promise<void>>>& promises, AuthErrorCode code) {
  for (const auto& promise : promises) {
    rejectIfPending(promise, code);
  }
}

void writeNativeLog(const std::string& message) {
#if defined(__ANDROID__)
  __android_log_print(ANDROID_LOG_DEBUG, "NitroAuth", "%s", message.c_str());
#else
  std::clog << "[NitroAuth] " << message << std::endl;
#endif
}

void mergeGrantedScopes(std::vector<std::string>& grantedScopes, const std::vector<std::string>& scopes) {
  std::unordered_set<std::string> knownScopes(grantedScopes.begin(), grantedScopes.end());
  grantedScopes.reserve(grantedScopes.size() + scopes.size());

  for (const auto& scope : scopes) {
    if (knownScopes.insert(scope).second) {
      grantedScopes.push_back(scope);
    }
  }
}

void removeGrantedScopes(std::vector<std::string>& grantedScopes, const std::vector<std::string>& scopes) {
  if (scopes.empty() || grantedScopes.empty()) {
    return;
  }

  const std::unordered_set<std::string> scopesToRemove(scopes.begin(), scopes.end());
  grantedScopes.erase(
    std::remove_if(grantedScopes.begin(), grantedScopes.end(),
      [&scopesToRemove](const std::string& scope) {
        return scopesToRemove.find(scope) != scopesToRemove.end();
      }),
    grantedScopes.end()
  );
}

template <typename TCallback, typename TValue>
void invokeListenersSafely(const std::vector<TCallback>& listeners, const TValue& value) {
  for (const auto& listener : listeners) {
    try {
      listener(value);
    } catch (...) {
      // Callback failures are isolated so one listener cannot block core state updates.
    }
  }
}

} // namespace

HybridAuth::HybridAuth() : HybridObject(TAG) {
  // In-memory only - no internal persistence.
}

std::optional<AuthUser> HybridAuth::getCurrentUser() {
  std::lock_guard<std::recursive_mutex> lock(_mutex);
  return _currentUser;
}

std::vector<std::string> HybridAuth::getGrantedScopes() {
  std::lock_guard<std::recursive_mutex> lock(_mutex);
  return _grantedScopes;
}

bool HybridAuth::getHasPlayServices() {
  return PlatformAuth::hasPlayServices();
}

void HybridAuth::notifyAuthStateChanged() {
  std::optional<AuthUser> user;
  std::optional<AuthProvider> provider;
  std::vector<std::function<void(const std::optional<AuthUser>&)>> listeners;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    user = _currentUser;
    if (user) {
      provider = user->provider;
    }
    listeners.reserve(_listeners.size());
    for (auto const& [id, listener] : _listeners) {
      listeners.push_back(listener);
    }
  }
  invokeListenersSafely(listeners, user);
  emitAuthEvent(AuthEventType::SESSION_CHANGED, provider);
}

std::function<void()> HybridAuth::onAuthStateChanged(const std::function<void(const std::optional<AuthUser>&)>& callback) {
  std::lock_guard<std::recursive_mutex> lock(_mutex);
  uint64_t id = _nextListenerId++;
  _listeners[id] = callback;
  
  auto weak = weak_from_this();
  return [weak, id]() {
    auto self = weak.lock();
    if (!self) return;
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) return;
    std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
    auth->_listeners.erase(id);
  };
}

std::function<void()> HybridAuth::onTokensRefreshed(const std::function<void(const AuthTokens&)>& callback) {
  std::lock_guard<std::recursive_mutex> lock(_mutex);
  uint64_t id = _nextTokenListenerId++;
  _tokenListeners[id] = callback;

  auto weak = weak_from_this();
  return [weak, id]() {
    auto self = weak.lock();
    if (!self) return;
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) return;
    std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
    auth->_tokenListeners.erase(id);
  };
}

std::function<void()> HybridAuth::onAuthEvent(const std::function<void(const AuthEvent&)>& callback) {
  std::lock_guard<std::recursive_mutex> lock(_mutex);
  uint64_t id = _nextEventListenerId++;
  _eventListeners[id] = callback;

  auto weak = weak_from_this();
  return [weak, id]() {
    auto self = weak.lock();
    if (!self) return;
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) return;
    std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
    auth->_eventListeners.erase(id);
  };
}

void HybridAuth::emitAuthEvent(AuthEventType type, std::optional<AuthProvider> provider, std::optional<AuthErrorCode> errorCode) {
  std::vector<std::function<void(const AuthEvent&)>> listeners;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    listeners.reserve(_eventListeners.size());
    for (auto const& [id, listener] : _eventListeners) {
      listeners.push_back(listener);
    }
  }
  AuthEvent event(type, provider, errorCode);
  invokeListenersSafely(listeners, event);
}

std::shared_ptr<Promise<AuthTokens>> HybridAuth::advanceSessionGenerationLocked() {
  _sessionGeneration++;
  auto refreshInFlight = _refreshInFlight;
  _refreshInFlight = nullptr;
  return refreshInFlight;
}

void HybridAuth::trackSessionPromiseLocked(const std::shared_ptr<Promise<void>>& promise) {
  _sessionPromises.erase(
    std::remove_if(_sessionPromises.begin(), _sessionPromises.end(), [](const std::weak_ptr<Promise<void>>& weak) {
      auto promise = weak.lock();
      return !promise || !promise->isPending();
    }),
    _sessionPromises.end()
  );
  _sessionPromises.push_back(promise);
}

std::vector<std::shared_ptr<Promise<void>>> HybridAuth::takePendingSessionPromisesLocked() {
  std::vector<std::shared_ptr<Promise<void>>> pending;
  for (const auto& weak : _sessionPromises) {
    auto promise = weak.lock();
    if (promise && promise->isPending()) {
      pending.push_back(promise);
    }
  }
  _sessionPromises.clear();
  return pending;
}

void HybridAuth::log(const std::string& message) {
  bool enabled;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    enabled = _loggingEnabled;
  }
  if (enabled) {
    writeNativeLog(message);
  }
}

void HybridAuth::logout() {
  log("logout");
  PlatformAuth::invalidatePendingOperations();
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
  std::optional<AuthProvider> provider;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    sessionPromises = takePendingSessionPromisesLocked();
    refreshInFlight = advanceSessionGenerationLocked();
    if (_currentUser) {
      provider = _currentUser->provider;
    }
    _currentUser = std::nullopt;
    _grantedScopes.clear();
  }
  rejectIfPending(refreshInFlight, AuthErrorCode::NOT_SIGNED_IN);
  rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  PlatformAuth::logout();
  notifyAuthStateChanged();
  emitAuthEvent(AuthEventType::LOGOUT, provider);
}

void HybridAuth::dispose() {
  log("dispose");
  PlatformAuth::invalidatePendingOperations();
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    sessionPromises = takePendingSessionPromisesLocked();
    refreshInFlight = advanceSessionGenerationLocked();
    _currentUser = std::nullopt;
    _grantedScopes.clear();
  }
  rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
  rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  PlatformAuth::logout();
  emitAuthEvent(AuthEventType::DISPOSE);
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    _listeners.clear();
    _tokenListeners.clear();
    _eventListeners.clear();
  }
}

std::shared_ptr<Promise<void>> HybridAuth::silentRestore() {
  log("silentRestore start");
  auto promise = Promise<void>::create();
  PlatformAuth::invalidatePendingOperations();
  uint64_t generation;
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    sessionPromises = takePendingSessionPromisesLocked();
    refreshInFlight = advanceSessionGenerationLocked();
    generation = _sessionGeneration;
    trackSessionPromiseLocked(promise);
  }
  rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
  rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  auto silentPromise = PlatformAuth::silentRestore();
  auto self = shared_from_this();
  silentPromise->addOnResolvedListener([self, promise, generation](const std::optional<AuthUser>& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeRawAuthError(AuthErrorCode::UNKNOWN, "internal_error"));
      return;
    }
    std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        auth->log("silentRestore cancelled");
        resolveIfPending(promise);
        return;
      }
      refreshInFlight = auth->advanceSessionGenerationLocked();
      auth->_currentUser = user;
      if (user) {
        if (user->scopes) {
          auth->_grantedScopes = *user->scopes;
        } else {
          auth->_grantedScopes.clear();
        }
      } else {
        auth->_grantedScopes.clear();
      }
    }
    rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
    auth->notifyAuthStateChanged();
    auth->log(user ? "silentRestore resolved with session" : "silentRestore resolved without session");
    resolveIfPending(promise);
  });
  
  silentPromise->addOnRejectedListener([self, promise](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (auth) {
      auth->log("silentRestore rejected");
    }
    if (promise->isPending()) {
      promise->reject(error);
    }
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
  log("login start");
  auto promise = Promise<void>::create();
  PlatformAuth::invalidatePendingOperations();
  uint64_t generation;
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    sessionPromises = takePendingSessionPromisesLocked();
    refreshInFlight = advanceSessionGenerationLocked();
    generation = _sessionGeneration;
    trackSessionPromiseLocked(promise);
  }
  rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
  rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  emitAuthEvent(AuthEventType::LOGIN_STARTED, provider);
  
  auto self = shared_from_this();
  auto loginPromise = PlatformAuth::login(provider, options);
  loginPromise->addOnResolvedListener([self, promise, options, generation, provider](const AuthUser& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      rejectIfPending(promise, makeRawAuthError(AuthErrorCode::UNKNOWN, "internal_error"));
      return;
    }
    std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        auth->log("login cancelled");
        rejectIfPending(promise, AuthErrorCode::CANCELLED);
        return;
      }
      refreshInFlight = auth->advanceSessionGenerationLocked();
      auth->_currentUser = user;
      if (user.scopes && !user.scopes->empty()) {
        auth->_grantedScopes = *user.scopes;
      } else if (options && options->scopes && !options->scopes->empty()) {
        auth->_grantedScopes = *options->scopes;
      } else {
        auth->_grantedScopes.clear();
      }
      if (auth->_currentUser) {
        auth->_currentUser->scopes = auth->_grantedScopes.empty()
          ? std::nullopt
          : std::make_optional(auth->_grantedScopes);
      }
    }
    rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
    auth->notifyAuthStateChanged();
    auth->emitAuthEvent(AuthEventType::LOGIN_SUCCEEDED, provider);
    auth->log("login resolved");
    resolveIfPending(promise);
  });
  
  loginPromise->addOnRejectedListener([self, promise, provider](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (auth) {
      auth->emitAuthEvent(AuthEventType::LOGIN_FAILED, provider, errorCodeOf(error));
      auth->log("login rejected");
    }
    if (promise->isPending()) {
      promise->reject(error);
    }
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::requestScopes(const std::vector<std::string>& scopes) {
  log("requestScopes start");
  auto promise = Promise<void>::create();
  PlatformAuth::invalidatePendingOperations();
  uint64_t generation;
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    sessionPromises = takePendingSessionPromisesLocked();
    refreshInFlight = advanceSessionGenerationLocked();
    generation = _sessionGeneration;
    trackSessionPromiseLocked(promise);
  }
  rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
  rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  auto self = shared_from_this();
  auto requestPromise = PlatformAuth::requestScopes(scopes);
  requestPromise->addOnResolvedListener([self, promise, scopes, generation](const AuthUser& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      rejectIfPending(promise, makeRawAuthError(AuthErrorCode::UNKNOWN, "internal_error"));
      return;
    }
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        auth->log("requestScopes cancelled");
        rejectIfPending(promise, AuthErrorCode::CANCELLED);
        return;
      }
      auth->_currentUser = user;
      mergeGrantedScopes(auth->_grantedScopes, scopes);
      if (auth->_currentUser) auth->_currentUser->scopes = auth->_grantedScopes;
    }
    auth->notifyAuthStateChanged();
    auth->log("requestScopes resolved");
    resolveIfPending(promise);
  });
  
  requestPromise->addOnRejectedListener([self, promise](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (auth) {
      auth->log("requestScopes rejected");
    }
    if (promise->isPending()) {
      promise->reject(error);
    }
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::revokeScopes(
    const std::vector<std::string>& scopes) {
  log("revokeScopes");
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    removeGrantedScopes(_grantedScopes, scopes);
    if (_currentUser) {
      _currentUser->scopes = _grantedScopes;
    }
  }
  notifyAuthStateChanged();
  auto promise = Promise<void>::create();
  promise->resolve();
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::revokeAccess() {
  log("revokeAccess start");
  auto promise = Promise<void>::create();
  AuthProvider provider;
  uint64_t generation = 0;
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    if (!_currentUser) {
      promise->reject(makeAuthError(AuthErrorCode::NOT_SIGNED_IN));
      return promise;
    }
    provider = _currentUser->provider;
  }
  PlatformAuth::invalidatePendingOperations();
  bool sessionStillActive = false;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    if (_currentUser) {
      sessionStillActive = true;
      provider = _currentUser->provider;
      sessionPromises = takePendingSessionPromisesLocked();
      refreshInFlight = advanceSessionGenerationLocked();
      generation = _sessionGeneration;
      trackSessionPromiseLocked(promise);
    }
  }
  if (!sessionStillActive) {
    PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
    promise->reject(makeAuthError(AuthErrorCode::NOT_SIGNED_IN));
    return promise;
  }

  rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
  rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  auto platformPromise = PlatformAuth::revokeAccess(provider);
  auto self = shared_from_this();
  platformPromise->addOnResolvedListener([self, promise, generation]() {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      rejectIfPending(promise, makeRawAuthError(AuthErrorCode::UNKNOWN, "internal_error"));
      return;
    }
    std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
    std::vector<std::shared_ptr<Promise<void>>> sessionPromises;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        rejectIfPending(promise, AuthErrorCode::CANCELLED);
        return;
      }
      sessionPromises = auth->takePendingSessionPromisesLocked();
      sessionPromises.erase(
        std::remove(sessionPromises.begin(), sessionPromises.end(), promise),
        sessionPromises.end()
      );
      refreshInFlight = auth->advanceSessionGenerationLocked();
      auth->_currentUser = std::nullopt;
      auth->_grantedScopes.clear();
    }
    rejectIfPending(refreshInFlight, AuthErrorCode::CANCELLED);
    rejectPendingSessionPromises(sessionPromises, AuthErrorCode::CANCELLED);
    auth->notifyAuthStateChanged();
    auth->log("revokeAccess resolved");
    resolveIfPending(promise);
  });
  platformPromise->addOnRejectedListener([self, promise](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (auth) {
      auth->log("revokeAccess rejected");
    }
    if (promise->isPending()) {
      promise->reject(error);
    }
  });
  return promise;
}

std::shared_ptr<Promise<std::optional<std::string>>> HybridAuth::getAccessToken() {
  log("getAccessToken");
  auto promise = Promise<std::optional<std::string>>::create();
  bool needsRefresh = false;
  std::optional<std::string> cachedAccessToken;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    if (_currentUser && _currentUser->accessToken) {
      cachedAccessToken = _currentUser->accessToken;
      if (_currentUser->expirationTime) {
        auto now = std::chrono::system_clock::now().time_since_epoch() / std::chrono::milliseconds(1);
        if (now + 300000 > *_currentUser->expirationTime) needsRefresh = true;
      }
      if (!needsRefresh) {
        promise->resolve(*_currentUser->accessToken);
        return promise;
      }
    } else {
      promise->resolve(std::nullopt);
      return promise;
    }
  }

  if (needsRefresh) {
    auto refreshPromise = refreshToken();
    refreshPromise->addOnResolvedListener([promise, cachedAccessToken](const AuthTokens& tokens) {
      promise->resolve(tokens.accessToken.has_value() ? tokens.accessToken : cachedAccessToken);
    });
    refreshPromise->addOnRejectedListener([promise](const std::exception_ptr& error) {
      promise->reject(error);
    });
  }
  return promise;
}

std::shared_ptr<Promise<AuthTokens>> HybridAuth::refreshToken() {
  log("refreshToken start");
  std::shared_ptr<Promise<AuthTokens>> promise;
  uint64_t generation;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    if (_refreshInFlight) {
      return _refreshInFlight;
    }
    generation = _sessionGeneration;
    promise = Promise<AuthTokens>::create();
    _refreshInFlight = promise;
  }

  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  auto self = shared_from_this();
  auto refreshPromise = PlatformAuth::refreshToken();
  refreshPromise->addOnResolvedListener([self, promise, generation](const AuthTokens& tokens) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeRawAuthError(AuthErrorCode::UNKNOWN, "internal_error"));
      return;
    }
    bool isStale = false;
    std::optional<AuthProvider> provider;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        if (auth->_refreshInFlight == promise) {
          auth->_refreshInFlight = nullptr;
        }
        isStale = true;
      } else {
        if (auth->_currentUser) {
          if (tokens.accessToken.has_value()) {
            auth->_currentUser->accessToken = tokens.accessToken;
          }
          if (tokens.idToken.has_value()) {
            auth->_currentUser->idToken = tokens.idToken;
          }
          if (tokens.refreshToken.has_value()) {
            auth->_currentUser->refreshToken = tokens.refreshToken;
          }
          if (tokens.expirationTime.has_value()) {
            auth->_currentUser->expirationTime = tokens.expirationTime;
          }
          provider = auth->_currentUser->provider;
        }
        if (auth->_refreshInFlight == promise) {
          auth->_refreshInFlight = nullptr;
        }
      }
    }
    if (isStale) {
      rejectIfPending(promise, AuthErrorCode::CANCELLED);
      return;
    }
    auth->notifyTokensRefreshed(tokens);
    auth->notifyAuthStateChanged();
    auth->emitAuthEvent(AuthEventType::TOKENS_REFRESHED, provider);
    auth->log("refreshToken resolved");
    promise->resolve(tokens);
  });

  refreshPromise->addOnRejectedListener([self, promise, generation](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeRawAuthError(AuthErrorCode::UNKNOWN, "internal_error"));
      return;
    }
    bool isStale = false;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        if (auth->_refreshInFlight == promise) {
          auth->_refreshInFlight = nullptr;
        }
        isStale = true;
      } else if (auth->_refreshInFlight == promise) {
        auth->_refreshInFlight = nullptr;
      }
    }
    if (isStale) {
      auth->log("refreshToken cancelled");
      rejectIfPending(promise, AuthErrorCode::CANCELLED);
      return;
    }
    auth->emitAuthEvent(AuthEventType::REFRESH_FAILED, std::nullopt, errorCodeOf(error));
    auth->log("refreshToken rejected");
    promise->reject(error);
  });
  return promise;
}
 
void HybridAuth::setLoggingEnabled(bool enabled) {
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    _loggingEnabled = enabled;
  }
  if (enabled) {
    writeNativeLog("native logging enabled");
  }
}

void HybridAuth::notifyTokensRefreshed(const AuthTokens& tokens) {
  std::vector<std::function<void(const AuthTokens&)>> listeners;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    listeners.reserve(_tokenListeners.size());
    for (auto const& [id, listener] : _tokenListeners) {
      listeners.push_back(listener);
    }
  }
  invokeListenersSafely(listeners, tokens);
}

} // namespace margelo::nitro::NitroAuth

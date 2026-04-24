#include "HybridAuth.hpp"
#include "PlatformAuth.hpp"
#include <algorithm>
#include <chrono>
#include <exception>
#include <stdexcept>
#include <unordered_set>

namespace margelo::nitro::NitroAuth {

namespace {

std::exception_ptr makeAuthError(const char* message) {
  return std::make_exception_ptr(std::runtime_error(message));
}

void rejectIfPending(const std::shared_ptr<Promise<AuthTokens>>& promise, const char* message) {
  if (promise && promise->isPending()) {
    promise->reject(makeAuthError(message));
  }
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
  std::vector<std::function<void(const std::optional<AuthUser>&)>> listeners;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    user = _currentUser;
    listeners.reserve(_listeners.size());
    for (auto const& [id, listener] : _listeners) {
      listeners.push_back(listener);
    }
  }
  invokeListenersSafely(listeners, user);
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

std::shared_ptr<Promise<AuthTokens>> HybridAuth::advanceSessionGenerationLocked() {
  _sessionGeneration++;
  auto refreshInFlight = _refreshInFlight;
  _refreshInFlight = nullptr;
  return refreshInFlight;
}

void HybridAuth::logout() {
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    refreshInFlight = advanceSessionGenerationLocked();
    _currentUser = std::nullopt;
    _grantedScopes.clear();
  }
  rejectIfPending(refreshInFlight, "not_signed_in");
  PlatformAuth::logout();
  notifyAuthStateChanged();
}

std::shared_ptr<Promise<void>> HybridAuth::silentRestore() {
  auto promise = Promise<void>::create();
  uint64_t generation;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    generation = _sessionGeneration;
  }
  auto silentPromise = PlatformAuth::silentRestore();
  auto self = shared_from_this();
  silentPromise->addOnResolvedListener([self, promise, generation](const std::optional<AuthUser>& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeAuthError("internal_error"));
      return;
    }
    std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        promise->resolve();
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
    rejectIfPending(refreshInFlight, "cancelled");
    // Always resolve - no session is not an error, just means user is logged out
    auth->notifyAuthStateChanged();
    promise->resolve();
  });
  
  silentPromise->addOnRejectedListener([promise](const std::exception_ptr&) {
    // Silently ignore errors during restore - user will be logged out
    promise->resolve();
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
  auto promise = Promise<void>::create();
  uint64_t generation;
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    refreshInFlight = advanceSessionGenerationLocked();
    generation = _sessionGeneration;
  }
  rejectIfPending(refreshInFlight, "cancelled");
  
  auto self = shared_from_this();
  auto loginPromise = PlatformAuth::login(provider, options);
  loginPromise->addOnResolvedListener([self, promise, options, generation](const AuthUser& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeAuthError("internal_error"));
      return;
    }
    std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        promise->reject(makeAuthError("cancelled"));
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
    rejectIfPending(refreshInFlight, "cancelled");
    auth->notifyAuthStateChanged();
    promise->resolve();
  });
  
  loginPromise->addOnRejectedListener([promise](const std::exception_ptr& error) {
    promise->reject(error);
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::requestScopes(const std::vector<std::string>& scopes) {
  auto promise = Promise<void>::create();
  uint64_t generation;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    generation = _sessionGeneration;
  }
  auto self = shared_from_this();
  auto requestPromise = PlatformAuth::requestScopes(scopes);
  requestPromise->addOnResolvedListener([self, promise, scopes, generation](const AuthUser& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeAuthError("internal_error"));
      return;
    }
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        promise->reject(makeAuthError("cancelled"));
        return;
      }
      auth->_currentUser = user;
      mergeGrantedScopes(auth->_grantedScopes, scopes);
      if (auth->_currentUser) auth->_currentUser->scopes = auth->_grantedScopes;
    }
    auth->notifyAuthStateChanged();
    promise->resolve();
  });
  
  requestPromise->addOnRejectedListener([promise](const std::exception_ptr& error) {
    promise->reject(error);
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::revokeScopes(const std::vector<std::string>& scopes) {
  auto promise = Promise<void>::create();
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    removeGrantedScopes(_grantedScopes, scopes);
    if (_currentUser) {
      _currentUser->scopes = _grantedScopes;
    }
  }
  notifyAuthStateChanged();
  promise->resolve();
  return promise;
}

std::shared_ptr<Promise<std::optional<std::string>>> HybridAuth::getAccessToken() {
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

  auto self = shared_from_this();
  auto refreshPromise = PlatformAuth::refreshToken();
  refreshPromise->addOnResolvedListener([self, promise, generation](const AuthTokens& tokens) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeAuthError("internal_error"));
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
        }
        if (auth->_refreshInFlight == promise) {
          auth->_refreshInFlight = nullptr;
        }
      }
    }
    if (isStale) {
      rejectIfPending(promise, "cancelled");
      return;
    }
    auth->notifyTokensRefreshed(tokens);
    auth->notifyAuthStateChanged();
    promise->resolve(tokens);
  });

  refreshPromise->addOnRejectedListener([self, promise, generation](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    if (!auth) {
      promise->reject(makeAuthError("internal_error"));
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
      rejectIfPending(promise, "cancelled");
      return;
    }
    promise->reject(error);
  });
  return promise;
}
 
void HybridAuth::setLoggingEnabled(bool /* enabled */) {
    // Reserved for future use — logging not yet implemented in C++ layer
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

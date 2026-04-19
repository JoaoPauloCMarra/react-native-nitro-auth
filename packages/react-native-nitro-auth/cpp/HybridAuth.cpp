#include "HybridAuth.hpp"
#include "PlatformAuth.hpp"
#include <algorithm>
#include <chrono>
#include <stdexcept>

namespace margelo::nitro::NitroAuth {

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
    for (auto const& [id, listener] : _listeners) {
      listeners.push_back(listener);
    }
  }
  for (const auto& listener : listeners) {
    listener(user);
  }
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
    std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
    auth->_tokenListeners.erase(id);
  };
}

void HybridAuth::logout() {
  std::shared_ptr<Promise<AuthTokens>> refreshInFlight;
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    _sessionGeneration++;
    _currentUser = std::nullopt;
    _grantedScopes.clear();
    refreshInFlight = _refreshInFlight;
    _refreshInFlight = nullptr;
  }
  if (refreshInFlight) {
    refreshInFlight->reject(
      std::make_exception_ptr(std::runtime_error("not_signed_in"))
    );
  }
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
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        promise->resolve();
        return;
      }
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
  {
    std::lock_guard<std::recursive_mutex> lock(_mutex);
    generation = _sessionGeneration;
  }
  
  auto self = shared_from_this();
  auto loginPromise = PlatformAuth::login(provider, options);
  loginPromise->addOnResolvedListener([self, promise, options, generation](const AuthUser& user) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        promise->reject(
          std::make_exception_ptr(std::runtime_error("cancelled"))
        );
        return;
      }
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
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        promise->reject(
          std::make_exception_ptr(std::runtime_error("cancelled"))
        );
        return;
      }
      auth->_currentUser = user;
      for (const auto& scope : scopes) {
        if (std::find(auth->_grantedScopes.begin(), auth->_grantedScopes.end(), scope) == auth->_grantedScopes.end()) {
          auth->_grantedScopes.push_back(scope);
        }
      }
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
    _grantedScopes.erase(
      std::remove_if(_grantedScopes.begin(), _grantedScopes.end(),
        [&scopes](const std::string& s) {
          return std::find(scopes.begin(), scopes.end(), s) != scopes.end();
        }),
      _grantedScopes.end()
    );
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
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        return;
      }
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
    auth->notifyTokensRefreshed(tokens);
    auth->notifyAuthStateChanged();
    promise->resolve(tokens);
  });

  refreshPromise->addOnRejectedListener([self, promise, generation](const std::exception_ptr& error) {
    auto* auth = dynamic_cast<HybridAuth*>(self.get());
    {
      std::lock_guard<std::recursive_mutex> lock(auth->_mutex);
      if (auth->_sessionGeneration != generation) {
        return;
      }
      if (auth->_refreshInFlight == promise) {
        auth->_refreshInFlight = nullptr;
      }
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
    for (auto const& [id, listener] : _tokenListeners) {
      listeners.push_back(listener);
    }
  }
  for (const auto& listener : listeners) {
    listener(tokens);
  }
}

} // namespace margelo::nitro::NitroAuth

#include "HybridAuth.hpp"
#include "PlatformAuth.hpp"
#include <NitroModules/NitroLogger.hpp>
#include <chrono>

namespace margelo::nitro::NitroAuth {
 
bool HybridAuth::sLoggingEnabled = false;

HybridAuth::HybridAuth() : HybridObject(TAG) {
  // In-memory only - no internal persistence.
}

std::optional<AuthUser> HybridAuth::getCurrentUser() {
  std::lock_guard<std::mutex> lock(_mutex);
  return _currentUser;
}

std::vector<std::string> HybridAuth::getGrantedScopes() {
  std::lock_guard<std::mutex> lock(_mutex);
  return _grantedScopes;
}

bool HybridAuth::getHasPlayServices() {
  return PlatformAuth::hasPlayServices();
}

void HybridAuth::notifyAuthStateChanged() {
  std::optional<AuthUser> user;
  std::vector<std::function<void(const std::optional<AuthUser>&)>> listeners;
  {
    std::lock_guard<std::mutex> lock(_mutex);
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
  std::lock_guard<std::mutex> lock(_mutex);
  int id = _nextListenerId++;
  _listeners[id] = callback;
  
  return [this, id]() {
    std::lock_guard<std::mutex> lock(_mutex);
    _listeners.erase(id);
  };
}

std::function<void()> HybridAuth::onTokensRefreshed(const std::function<void(const AuthTokens&)>& callback) {
  std::lock_guard<std::mutex> lock(_mutex);
  int id = _nextTokenListenerId++;
  _tokenListeners[id] = callback;
  
  return [this, id]() {
    std::lock_guard<std::mutex> lock(_mutex);
    _tokenListeners.erase(id);
  };
}

void HybridAuth::logout() {
  {
    std::lock_guard<std::mutex> lock(_mutex);
    _currentUser = std::nullopt;
    _grantedScopes.clear();
  }
  PlatformAuth::logout();
  notifyAuthStateChanged();
}

std::shared_ptr<Promise<void>> HybridAuth::silentRestore() {
  auto promise = Promise<void>::create();
  auto silentPromise = PlatformAuth::silentRestore();
  silentPromise->addOnResolvedListener([this, promise](const std::optional<AuthUser>& user) {
    {
      std::lock_guard<std::mutex> lock(_mutex);
      _currentUser = user;
      if (user) {
        if (user->scopes) {
          _grantedScopes = *user->scopes;
        } else {
          _grantedScopes.clear();
        }
      } else {
        _grantedScopes.clear();
      }
    }
    // Always resolve - no session is not an error, just means user is logged out
    notifyAuthStateChanged();
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
  
  auto loginPromise = PlatformAuth::login(provider, options);
  loginPromise->addOnResolvedListener([this, promise, options](const AuthUser& user) {
    {
      std::lock_guard<std::mutex> lock(_mutex);
      _currentUser = user;
      if (user.scopes && !user.scopes->empty()) {
        _grantedScopes = *user.scopes;
      } else if (options && options->scopes && !options->scopes->empty()) {
        _grantedScopes = *options->scopes;
      } else {
        _grantedScopes.clear();
      }
      if (_currentUser) {
        _currentUser->scopes = _grantedScopes.empty()
          ? std::nullopt
          : std::make_optional(_grantedScopes);
      }
    }
    notifyAuthStateChanged();
    promise->resolve();
  });
  
  loginPromise->addOnRejectedListener([promise](const std::exception_ptr& error) {
    promise->reject(error);
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridAuth::requestScopes(const std::vector<std::string>& scopes) {
  auto promise = Promise<void>::create();
  auto requestPromise = PlatformAuth::requestScopes(scopes);
  requestPromise->addOnResolvedListener([this, promise, scopes](const AuthUser& user) {
    {
      std::lock_guard<std::mutex> lock(_mutex);
      _currentUser = user;
      for (const auto& scope : scopes) {
        if (std::find(_grantedScopes.begin(), _grantedScopes.end(), scope) == _grantedScopes.end()) {
          _grantedScopes.push_back(scope);
        }
      }
      if (_currentUser) _currentUser->scopes = _grantedScopes;
    }
    notifyAuthStateChanged();
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
    std::lock_guard<std::mutex> lock(_mutex);
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
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (_currentUser && _currentUser->accessToken) {
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
    refreshPromise->addOnResolvedListener([promise](const AuthTokens& tokens) {
      promise->resolve(tokens.accessToken);
    });
    refreshPromise->addOnRejectedListener([promise](const std::exception_ptr& error) {
      promise->reject(error);
    });
  }
  return promise;
}

std::shared_ptr<Promise<AuthTokens>> HybridAuth::refreshToken() {
  auto promise = Promise<AuthTokens>::create();
  auto refreshPromise = PlatformAuth::refreshToken();
  refreshPromise->addOnResolvedListener([this, promise](const AuthTokens& tokens) {
    {
      std::lock_guard<std::mutex> lock(_mutex);
      if (_currentUser) {
        if (tokens.accessToken.has_value()) {
          _currentUser->accessToken = tokens.accessToken;
        }
        if (tokens.idToken.has_value()) {
          _currentUser->idToken = tokens.idToken;
        }
        if (tokens.refreshToken.has_value()) {
          _currentUser->refreshToken = tokens.refreshToken;
        }
        if (tokens.expirationTime.has_value()) {
          _currentUser->expirationTime = tokens.expirationTime;
        }
      }
    }
    notifyTokensRefreshed(tokens);
    notifyAuthStateChanged();
    promise->resolve(tokens);
  });
  
  refreshPromise->addOnRejectedListener([promise](const std::exception_ptr& error) {
    promise->reject(error);
  });
  return promise;
}
 
void HybridAuth::setLoggingEnabled(bool enabled) {
  sLoggingEnabled = enabled;
}

void HybridAuth::notifyTokensRefreshed(const AuthTokens& tokens) {
  std::vector<std::function<void(const AuthTokens&)>> listeners;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    for (auto const& [id, listener] : _tokenListeners) {
      listeners.push_back(listener);
    }
  }
  for (const auto& listener : listeners) {
    listener(tokens);
  }
}

} // namespace margelo::nitro::NitroAuth

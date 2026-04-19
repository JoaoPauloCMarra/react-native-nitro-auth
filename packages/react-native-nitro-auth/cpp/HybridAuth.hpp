#pragma once

#include "HybridAuthSpec.hpp"
#include "AuthUser.hpp"
#include "LoginOptions.hpp"
#include "AuthTokens.hpp"
#include <cstdint>
#include <optional>
#include <mutex>
#include <memory>
#include <string>
#include <map>

namespace margelo::nitro::NitroAuth {

class HybridAuth: public HybridAuthSpec {
public:
  HybridAuth();

  std::optional<AuthUser> getCurrentUser() override;
  std::vector<std::string> getGrantedScopes() override;
  bool getHasPlayServices() override;

  std::shared_ptr<Promise<void>> login(AuthProvider provider, const std::optional<LoginOptions>& options) override;
  std::shared_ptr<Promise<void>> requestScopes(const std::vector<std::string>& scopes) override;
  std::shared_ptr<Promise<void>> revokeScopes(const std::vector<std::string>& scopes) override;
  std::shared_ptr<Promise<std::optional<std::string>>> getAccessToken() override;
  std::shared_ptr<Promise<AuthTokens>> refreshToken() override;

  void logout() override;
  std::shared_ptr<Promise<void>> silentRestore() override;
  std::function<void()> onAuthStateChanged(const std::function<void(const std::optional<AuthUser>&)>& callback) override;
  std::function<void()> onTokensRefreshed(const std::function<void(const AuthTokens&)>& callback) override;
  void setLoggingEnabled(bool enabled) override;
  // Note: setStorageAdapter is kept internally but not exposed in public API
  // Storage is in-memory only by default

private:
  void notifyAuthStateChanged();
  void notifyTokensRefreshed(const AuthTokens& tokens);

private:
  std::optional<AuthUser> _currentUser;
  std::vector<std::string> _grantedScopes;
  std::map<uint64_t, std::function<void(const std::optional<AuthUser>&)>> _listeners;
  uint64_t _nextListenerId = 0;

  std::map<uint64_t, std::function<void(const AuthTokens&)>> _tokenListeners;
  uint64_t _nextTokenListenerId = 0;
  std::shared_ptr<Promise<AuthTokens>> _refreshInFlight;
  uint64_t _sessionGeneration = 0;
  
  // recursive_mutex: listeners resolved inside a lock scope may re-enter Auth methods
  // that also acquire _mutex, causing deadlock with a non-recursive mutex.
  std::recursive_mutex _mutex;

  static constexpr auto TAG = "Auth";
};

} // namespace margelo::nitro::NitroAuth

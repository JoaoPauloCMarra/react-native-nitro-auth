#pragma once

#include "HybridAuthSpec.hpp"
#include "AuthUser.hpp"
#include "LoginOptions.hpp"
#include "AuthTokens.hpp"
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
  void setStorageAdapter(const std::optional<std::shared_ptr<HybridAuthStorageAdapterSpec>>& adapter) override;

private:
  void loadFromCache();
  void saveToCache(const std::optional<AuthUser>& user);
  void notifyAuthStateChanged();
  void notifyTokensRefreshed(const AuthTokens& tokens);

private:
  std::optional<AuthUser> _currentUser;
  std::vector<std::string> _grantedScopes;
  std::map<int, std::function<void(const std::optional<AuthUser>&)>> _listeners;
  int _nextListenerId = 0;
  
  std::shared_ptr<HybridAuthStorageAdapterSpec> _storageAdapter;
  std::map<int, std::function<void(const AuthTokens&)>> _tokenListeners;
  int _nextTokenListenerId = 0;
  
  std::mutex _mutex;

  static constexpr auto TAG = "Auth";
  static bool sLoggingEnabled;
};

} // namespace margelo::nitro::NitroAuth

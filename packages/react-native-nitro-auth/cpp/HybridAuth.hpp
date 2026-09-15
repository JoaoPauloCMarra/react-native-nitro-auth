#pragma once

#include "HybridAuthSpec.hpp"
#include "AuthNonce.hpp"
#include "AuthUser.hpp"
#include "AuthEvent.hpp"
#include "LoginOptions.hpp"
#include "AuthTokens.hpp"
#include <cstdint>
#include <optional>
#include <mutex>
#include <memory>
#include <string>
#include <map>
#include <vector>

namespace margelo::nitro::NitroAuth {

class HybridAuth: public HybridAuthSpec {
public:
  HybridAuth();

  std::optional<AuthUser> getCurrentUser() override;
  std::vector<std::string> getGrantedScopes() override;
  bool getHasPlayServices() override;

  std::shared_ptr<Promise<AuthNonce>> createNonce() override;
  AuthSessionSnapshot getSessionSnapshot() override;
  std::function<void()> onSessionChanged(const std::function<void(const AuthSessionSnapshot&)>& callback) override;
  std::shared_ptr<Promise<AuthCredential>> getCredential(CredentialProvider provider, const std::optional<LoginOptions>& options) override;
  std::shared_ptr<Promise<AuthUser>> loginAndGetUser(AuthProvider provider, const std::optional<LoginOptions>& options) override;
  std::shared_ptr<Promise<ScopeRevocationResult>> revokeScopesWithResult(const std::vector<std::string>& scopes) override;
  std::shared_ptr<Promise<void>> login(AuthProvider provider, const std::optional<LoginOptions>& options) override;
  std::shared_ptr<Promise<void>> requestScopes(const std::vector<std::string>& scopes) override;
  std::shared_ptr<Promise<void>> revokeScopes(const std::vector<std::string>& scopes) override;
  std::shared_ptr<Promise<void>> revokeAccess() override;
  std::shared_ptr<Promise<std::optional<std::string>>> getAccessToken() override;
  std::shared_ptr<Promise<AuthTokens>> refreshToken() override;

  void logout() override;
  std::shared_ptr<Promise<void>> silentRestore() override;
  std::function<void()> onAuthStateChanged(const std::function<void(const std::optional<AuthUser>&)>& callback) override;
  std::function<void()> onTokensRefreshed(const std::function<void(const AuthTokens&)>& callback) override;
  std::function<void()> onAuthEvent(const std::function<void(const AuthEvent&)>& callback) override;
  void setLoggingEnabled(bool enabled) override;
  void dispose() override;

private:
  void notifyAuthStateChanged();
  bool credentialInProgress();
  void cancelCredential();
  void finishCredential(const std::shared_ptr<Promise<AuthCredential>>& promise, const std::optional<AuthCredential>& credential, std::exception_ptr error);
  std::shared_ptr<Promise<void>> loginImpl(AuthProvider provider, const std::optional<LoginOptions>& options, const std::shared_ptr<Promise<AuthUser>>& result);
  void notifyTokensRefreshed(const AuthTokens& tokens);
  void emitAuthEvent(AuthEventType type, std::optional<AuthProvider> provider = std::nullopt, std::optional<AuthErrorCode> errorCode = std::nullopt);
  std::shared_ptr<Promise<AuthTokens>> advanceSessionGenerationLocked();
  void trackSessionPromiseLocked(const std::shared_ptr<Promise<void>>& promise);
  std::vector<std::shared_ptr<Promise<void>>> takePendingSessionPromisesLocked();
  void log(const std::string& message);

private:
  std::optional<AuthUser> _currentUser;
  std::vector<std::string> _grantedScopes;
  std::map<uint64_t, std::function<void(const std::optional<AuthUser>&)>> _listeners;
  uint64_t _nextListenerId = 0;

  std::map<uint64_t, std::function<void(const AuthTokens&)>> _tokenListeners;
  uint64_t _nextTokenListenerId = 0;
  std::map<uint64_t, std::function<void(const AuthEvent&)>> _eventListeners;
  uint64_t _nextEventListenerId = 0;
  std::shared_ptr<Promise<AuthTokens>> _refreshInFlight;
  std::vector<std::weak_ptr<Promise<void>>> _sessionPromises;
  uint64_t _sessionGeneration = 0;
  uint64_t _snapshotRevision = 0;
  uint64_t _nextSnapshotListenerId = 0;
  std::map<uint64_t, std::function<void(const AuthSessionSnapshot&)>> _snapshotListeners;
  std::shared_ptr<Promise<AuthCredential>> _credentialPromise;
  bool _loggingEnabled = false;

  // recursive_mutex: listeners resolved inside a lock scope may re-enter Auth methods
  // that also acquire _mutex, causing deadlock with a non-recursive mutex.
  std::recursive_mutex _mutex;

  static constexpr auto TAG = "Auth";
};

} // namespace margelo::nitro::NitroAuth

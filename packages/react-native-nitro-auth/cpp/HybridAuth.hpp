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

// Callers hold the owner's mutex around every call.
template <typename Callback>
class ListenerRegistry {
public:
  uint64_t add(Callback callback) {
    const auto id = _nextId++;
    _entries[id] = std::move(callback);
    return id;
  }

  void remove(uint64_t id) { _entries.erase(id); }

  void clear() { _entries.clear(); }

  std::vector<Callback> snapshot() const {
    std::vector<Callback> callbacks;
    callbacks.reserve(_entries.size());
    for (const auto& [id, callback] : _entries) callbacks.push_back(callback);
    return callbacks;
  }

private:
  std::map<uint64_t, Callback> _entries;
  uint64_t _nextId = 0;
};

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
  void setUserScopesLocked();
  template <typename Callback>
  std::function<void()> subscribe(ListenerRegistry<Callback> HybridAuth::* registry, const Callback& callback);
  std::shared_ptr<Promise<AuthTokens>> advanceSessionGenerationLocked();
  void trackSessionPromiseLocked(const std::shared_ptr<Promise<void>>& promise);
  std::vector<std::shared_ptr<Promise<void>>> takePendingSessionPromisesLocked();
  uint64_t supersedeSession(const std::shared_ptr<Promise<void>>& promise);
  bool hasPendingSessionOperationLocked() const;
  void log(const std::string& message);

private:
  std::optional<AuthUser> _currentUser;
  std::vector<std::string> _grantedScopes;
  ListenerRegistry<std::function<void(const std::optional<AuthUser>&)>> _listeners;
  ListenerRegistry<std::function<void(const AuthTokens&)>> _tokenListeners;
  ListenerRegistry<std::function<void(const AuthEvent&)>> _eventListeners;
  std::shared_ptr<Promise<AuthTokens>> _refreshInFlight;
  std::vector<std::weak_ptr<Promise<void>>> _sessionPromises;
  uint64_t _sessionGeneration = 0;
  uint64_t _snapshotRevision = 0;
  ListenerRegistry<std::function<void(const AuthSessionSnapshot&)>> _snapshotListeners;
  std::shared_ptr<Promise<AuthCredential>> _credentialPromise;
  bool _loggingEnabled = false;

  // recursive_mutex: listeners resolved inside a lock scope may re-enter Auth methods
  // that also acquire _mutex, causing deadlock with a non-recursive mutex.
  std::recursive_mutex _mutex;

  static constexpr auto TAG = "Auth";
};

} // namespace margelo::nitro::NitroAuth

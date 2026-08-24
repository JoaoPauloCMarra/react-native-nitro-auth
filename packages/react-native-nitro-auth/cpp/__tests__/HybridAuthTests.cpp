#include <algorithm>
#include <cassert>
#include <chrono>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>
#include "../HybridAuth.hpp"
#include "../PlatformAuth.hpp"
#include "../AuthError.hpp"

using namespace margelo::nitro::NitroAuth;

namespace margelo::nitro::NitroAuth {

void HybridAuthSpec::loadHybridMethods() {}

namespace {

std::shared_ptr<Promise<AuthUser>> lastLoginPromise;
std::shared_ptr<Promise<AuthUser>> lastRequestScopesPromise;
std::shared_ptr<Promise<AuthTokens>> lastRefreshPromise;
std::shared_ptr<Promise<std::optional<AuthUser>>> lastSilentRestorePromise;
std::shared_ptr<Promise<void>> lastRevokeAccessPromise;
std::optional<AuthProvider> lastRevokedProvider;
bool didLogout = false;
bool didRevokeAccess = false;
int platformCancellationCount = 0;
int platformInvalidationCount = 0;

AuthUser makeUser(
  const std::optional<std::vector<std::string>>& scopes = std::nullopt,
  const std::optional<std::string>& accessToken = std::nullopt,
  const std::optional<double>& expirationTime = std::nullopt
) {
  AuthUser user;
  user.provider = AuthProvider::GOOGLE;
  user.email = "test@example.com";
  user.scopes = scopes;
  user.accessToken = accessToken;
  user.expirationTime = expirationTime;
  return user;
}

AuthTokens makeTokens(
  const std::optional<std::string>& accessToken,
  const std::optional<std::string>& idToken = std::nullopt,
  const std::optional<std::string>& refreshToken = std::nullopt,
  const std::optional<double>& expirationTime = std::nullopt
) {
  AuthTokens tokens;
  tokens.accessToken = accessToken;
  tokens.idToken = idToken;
  tokens.refreshToken = refreshToken;
  tokens.expirationTime = expirationTime;
  return tokens;
}

double futureTimestampMs() {
  auto now = std::chrono::system_clock::now().time_since_epoch() / std::chrono::milliseconds(1);
  return static_cast<double>(now + 600000);
}

double expiredTimestampMs() {
  auto now = std::chrono::system_clock::now().time_since_epoch() / std::chrono::milliseconds(1);
  return static_cast<double>(now - 1000);
}

void resetPlatformMocks() {
  lastLoginPromise = nullptr;
  lastRequestScopesPromise = nullptr;
  lastRefreshPromise = nullptr;
  lastSilentRestorePromise = nullptr;
  lastRevokeAccessPromise = nullptr;
  lastRevokedProvider = std::nullopt;
  didLogout = false;
  didRevokeAccess = false;
  platformCancellationCount = 0;
  platformInvalidationCount = 0;
}

} // namespace

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider, const std::optional<LoginOptions>&) {
  lastLoginPromise = Promise<AuthUser>::create();
  return lastLoginPromise;
}

std::shared_ptr<Promise<AuthUser>> PlatformAuth::requestScopes(const std::vector<std::string>&) {
  lastRequestScopesPromise = Promise<AuthUser>::create();
  return lastRequestScopesPromise;
}

std::shared_ptr<Promise<AuthTokens>> PlatformAuth::refreshToken() {
  lastRefreshPromise = Promise<AuthTokens>::create();
  return lastRefreshPromise;
}

std::shared_ptr<Promise<std::optional<AuthUser>>> PlatformAuth::silentRestore() {
  lastSilentRestorePromise = Promise<std::optional<AuthUser>>::create();
  return lastSilentRestorePromise;
}

bool PlatformAuth::hasPlayServices() {
  return true;
}

void PlatformAuth::invalidatePendingOperations() {
  platformInvalidationCount++;
}

void PlatformAuth::cancelPendingOperations(AuthErrorCode reason) {
  platformCancellationCount++;
  const auto cancellation = makeAuthError(reason);
  if (lastLoginPromise && lastLoginPromise->isPending()) lastLoginPromise->reject(cancellation);
  if (lastRequestScopesPromise && lastRequestScopesPromise->isPending()) lastRequestScopesPromise->reject(cancellation);
  if (lastRefreshPromise && lastRefreshPromise->isPending()) lastRefreshPromise->reject(cancellation);
  if (lastSilentRestorePromise && lastSilentRestorePromise->isPending()) lastSilentRestorePromise->reject(cancellation);
  if (lastRevokeAccessPromise && lastRevokeAccessPromise->isPending()) lastRevokeAccessPromise->reject(cancellation);
}

void PlatformAuth::logout() {
  didLogout = true;
}

std::shared_ptr<Promise<void>> PlatformAuth::revokeAccess(AuthProvider provider) {
  didRevokeAccess = true;
  lastRevokedProvider = provider;
  lastRevokeAccessPromise = Promise<void>::create();
  return lastRevokeAccessPromise;
}

} // namespace margelo::nitro::NitroAuth

namespace {

void testScopeMergesAndRemovals() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}));
  assert(loginPromise->isResolved());

  auto requestPromise = auth->requestScopes({"email", "profile", "email"});
  lastRequestScopesPromise->resolve(makeUser());
  assert(requestPromise->isResolved());

  const std::vector<std::string> expectedScopes{"profile", "email"};
  assert(auth->getGrantedScopes() == expectedScopes);
  assert(auth->getCurrentUser()->scopes == expectedScopes);

  auto revokePromise = auth->revokeScopes({"profile", "missing", "profile"});
  assert(revokePromise->isResolved());

  const std::vector<std::string> remainingScopes{"email"};
  assert(auth->getGrantedScopes() == remainingScopes);
  assert(auth->getCurrentUser()->scopes == remainingScopes);
}

void testListenerExceptionsDoNotBlockStateUpdates() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  int listenerCalls = 0;

  auth->onAuthStateChanged([](const std::optional<AuthUser>&) {
    throw std::runtime_error("listener failed");
  });
  auth->onAuthStateChanged([&listenerCalls](const std::optional<AuthUser>&) {
    listenerCalls++;
  });

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "fresh"));

  assert(loginPromise->isResolved());
  assert(listenerCalls == 1);
  assert(auth->getCurrentUser()->accessToken == "fresh");
}

void testRefreshCancelledWhenSessionChanges() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "old"));
  assert(loginPromise->isResolved());

  auto refreshPromise = auth->refreshToken();
  auto stalePlatformRefresh = lastRefreshPromise;
  auto duplicateRefreshPromise = auth->refreshToken();
  assert(refreshPromise == duplicateRefreshPromise);

  auto replacementLoginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(refreshPromise->isRejected());
  assert(stalePlatformRefresh->isRejected());
  assert(platformCancellationCount == 3);
  assert(platformInvalidationCount == 2);

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "new"));
  assert(replacementLoginPromise->isResolved());

  assert(auth->getCurrentUser()->accessToken == "new");
}

void testNewLoginReleasesStalePlatformSlotBeforeReplacementStarts() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto firstRestore = auth->silentRestore();
  auto stalePlatformRestore = lastSilentRestorePromise;
  auto secondLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);

  assert(firstRestore->isRejected());
  assert(stalePlatformRestore->isRejected());
  assert(platformCancellationCount == 2);
  assert(platformInvalidationCount == 2);
  assert(lastLoginPromise != nullptr);

  assert(!auth->getCurrentUser().has_value());

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "fresh"));
  assert(secondLogin->isResolved());
  assert(auth->getCurrentUser()->accessToken == "fresh");
}

void testLoginStartInvalidatesSilentRestore() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto restorePromise = auth->silentRestore();
  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);

  assert(restorePromise->isRejected());
  assert(!auth->getCurrentUser().has_value());

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "interactive"));
  assert(loginPromise->isResolved());
  assert(auth->getCurrentUser()->accessToken == "interactive");
}

void testPendingLoginCancelledWhenSessionChanges() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto firstLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  auto secondLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);

  assert(firstLogin->isRejected());

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "second"));
  assert(secondLogin->isResolved());
  assert(auth->getCurrentUser()->accessToken == "second");
}

void testRevokeAccessRequiresSession() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto revokePromise = auth->revokeAccess();

  assert(revokePromise->isRejected());
  assert(!didRevokeAccess);
}

void testRevokeAccessClearsSessionOnlyAfterProviderRevocation() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "active"));
  assert(loginPromise->isResolved());

  auto failedRevoke = auth->revokeAccess();
  assert(didRevokeAccess);
  assert(lastRevokedProvider == AuthProvider::GOOGLE);
  assert(auth->getCurrentUser().has_value());
  lastRevokeAccessPromise->reject(makeAuthError(AuthErrorCode::NETWORK_ERROR));
  assert(failedRevoke->isRejected());
  assert(auth->getCurrentUser().has_value());

  auto successfulRevoke = auth->revokeAccess();
  lastRevokeAccessPromise->resolve();
  assert(successfulRevoke->isResolved());
  assert(!auth->getCurrentUser().has_value());
  assert(auth->getGrantedScopes().empty());
}

void testLogoutCancelsPendingRevokeAccess() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "active"));
  assert(loginPromise->isResolved());

  auto revokePromise = auth->revokeAccess();
  assert(revokePromise->isPending());

  auth->logout();

  assert(revokePromise->isRejected());
  assert(!auth->getCurrentUser().has_value());
}

void testNewLoginReleasesPendingRevokeBeforeReplacementStarts() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "active"));
  assert(loginPromise->isResolved());

  auto revokePromise = auth->revokeAccess();
  auto stalePlatformRevoke = lastRevokeAccessPromise;
  auto replacementLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);

  assert(revokePromise->isRejected());
  assert(stalePlatformRevoke->isRejected());
  assert(lastLoginPromise != nullptr);

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "replacement"));
  assert(replacementLogin->isResolved());
  assert(auth->getCurrentUser()->accessToken == "replacement");

  auto laterRevoke = auth->revokeAccess();
  assert(laterRevoke->isPending());
  assert(lastRevokeAccessPromise != stalePlatformRevoke);
  lastRevokeAccessPromise->resolve();
  assert(laterRevoke->isResolved());
}

void testLogoutCancelsRefreshAndClearsSession() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "old"));
  assert(loginPromise->isResolved());

  auto refreshPromise = auth->refreshToken();
  auth->logout();

  assert(refreshPromise->isRejected());
  assert(didLogout);
  assert(!auth->getCurrentUser().has_value());
  assert(auth->getGrantedScopes().empty());

  if (lastRefreshPromise->isPending()) {
    lastRefreshPromise->resolve(makeTokens("stale"));
  }
  assert(!auth->getCurrentUser().has_value());
}

void testSynchronousAccessorsAndListenerUnsubscribe() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  int authListenerCalls = 0;
  int tokenListenerCalls = 0;

  assert(auth->getHasPlayServices());
  auto unsubscribeAuth = auth->onAuthStateChanged([&authListenerCalls](const std::optional<AuthUser>&) {
    authListenerCalls++;
  });
  auto unsubscribeTokens = auth->onTokensRefreshed([&tokenListenerCalls](const AuthTokens&) {
    tokenListenerCalls++;
  });

  unsubscribeAuth();
  unsubscribeTokens();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "token"));
  assert(loginPromise->isResolved());

  auto refreshPromise = auth->refreshToken();
  lastRefreshPromise->resolve(makeTokens("new-token"));
  assert(refreshPromise->isResolved());
  assert(authListenerCalls == 0);
  assert(tokenListenerCalls == 0);
}

void testSilentRestoreResolvedEmptyAndRejectedPaths() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto restoreWithUser = auth->silentRestore();
  lastSilentRestorePromise->resolve(makeUser(std::vector<std::string>{"profile"}, "restored"));
  assert(restoreWithUser->isResolved());
  assert(auth->getCurrentUser()->accessToken == "restored");
  assert(auth->getGrantedScopes() == std::vector<std::string>{"profile"});

  auto restoreWithoutUser = auth->silentRestore();
  lastSilentRestorePromise->resolve(std::nullopt);
  assert(restoreWithoutUser->isResolved());
  assert(!auth->getCurrentUser().has_value());
  assert(auth->getGrantedScopes().empty());

  auto rejectedRestore = auth->silentRestore();
  lastSilentRestorePromise->reject(std::make_exception_ptr(std::runtime_error("native failure")));
  assert(rejectedRestore->isRejected());
}

void testLoginScopeFallbackAndRejectionPaths() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  LoginOptions options;
  options.scopes = std::vector<std::string>{"email"};
  auto scopedLogin = auth->login(AuthProvider::GOOGLE, options);
  lastLoginPromise->resolve(makeUser());
  assert(scopedLogin->isResolved());
  assert(auth->getGrantedScopes() == std::vector<std::string>{"email"});
  assert(auth->getCurrentUser()->scopes == std::vector<std::string>{"email"});

  auto emptyLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{}));
  assert(emptyLogin->isResolved());
  assert(auth->getGrantedScopes().empty());
  assert(!auth->getCurrentUser()->scopes.has_value());

  auto rejectedLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->reject(makeAuthError(AuthErrorCode::CANCELLED));
  assert(rejectedLogin->isRejected());
}

void testScopeRejectionAndNoUserRevokePaths() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto requestPromise = auth->requestScopes({"email"});
  lastRequestScopesPromise->reject(std::make_exception_ptr(std::runtime_error("scope failure")));
  assert(requestPromise->isRejected());

  auto revokePromise = auth->revokeScopes({"email"});
  assert(revokePromise->isResolved());
  assert(!auth->getCurrentUser().has_value());
  assert(auth->getGrantedScopes().empty());
}

void testAccessTokenReadRefreshAndFallbackPaths() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto noUserToken = auth->getAccessToken();
  assert(noUserToken->isResolved());
  assert(!noUserToken->getResult().has_value());

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "fresh", futureTimestampMs()));
  assert(loginPromise->isResolved());

  auto cachedToken = auth->getAccessToken();
  assert(cachedToken->isResolved());
  assert(cachedToken->getResult() == "fresh");

  auto staleLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "stale", expiredTimestampMs()));
  assert(staleLogin->isResolved());

  auto refreshedToken = auth->getAccessToken();
  assert(refreshedToken->isPending());
  lastRefreshPromise->resolve(makeTokens("refreshed", "id-token", "refresh-token", futureTimestampMs()));
  assert(refreshedToken->isResolved());
  assert(refreshedToken->getResult() == "refreshed");
  assert(auth->getCurrentUser()->idToken == "id-token");
  assert(auth->getCurrentUser()->refreshToken == "refresh-token");

  auto fallbackLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "fallback", expiredTimestampMs()));
  assert(fallbackLogin->isResolved());

  auto fallbackToken = auth->getAccessToken();
  lastRefreshPromise->resolve(makeTokens(std::nullopt, "id-token-2"));
  assert(fallbackToken->isResolved());
  assert(fallbackToken->getResult() == "fallback");

  auto failingLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "old", expiredTimestampMs()));
  assert(failingLogin->isResolved());

  auto failedToken = auth->getAccessToken();
  lastRefreshPromise->reject(std::make_exception_ptr(std::runtime_error("refresh failure")));
  assert(failedToken->isRejected());
}

void testRefreshTokenSuccessFailureAndTokenListenerPaths() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  int tokenListenerCalls = 0;

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "old", expiredTimestampMs()));
  assert(loginPromise->isResolved());

  auth->onTokensRefreshed([&tokenListenerCalls](const AuthTokens&) {
    throw std::runtime_error("listener failure");
  });
  auth->onTokensRefreshed([&tokenListenerCalls](const AuthTokens& tokens) {
    assert(tokens.accessToken == "new");
    tokenListenerCalls++;
  });

  auto refreshPromise = auth->refreshToken();
  lastRefreshPromise->resolve(makeTokens("new", "id", "refresh", futureTimestampMs()));
  assert(refreshPromise->isResolved());
  assert(tokenListenerCalls == 1);
  assert(auth->getCurrentUser()->accessToken == "new");
  assert(auth->getCurrentUser()->expirationTime.has_value());

  auto failedRefresh = auth->refreshToken();
  lastRefreshPromise->reject(std::make_exception_ptr(std::runtime_error("network")));
  assert(failedRefresh->isRejected());

  auth->setLoggingEnabled(true);
}

void testTypedAuthEventsAcrossLoginRefreshLogout() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  std::vector<AuthEventType> eventTypes;
  std::optional<AuthProvider> loginFailedProvider;
  std::optional<AuthErrorCode> loginFailedCode;

  auth->onAuthEvent([&](const AuthEvent& event) {
    eventTypes.push_back(event.type);
    if (event.type == AuthEventType::LOGIN_FAILED) {
      loginFailedProvider = event.provider;
      loginFailedCode = event.errorCode;
    }
  });

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(std::find(eventTypes.begin(), eventTypes.end(), AuthEventType::LOGIN_STARTED) != eventTypes.end());
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "fresh", futureTimestampMs()));
  assert(loginPromise->isResolved());
  assert(std::find(eventTypes.begin(), eventTypes.end(), AuthEventType::LOGIN_SUCCEEDED) != eventTypes.end());
  assert(std::find(eventTypes.begin(), eventTypes.end(), AuthEventType::SESSION_CHANGED) != eventTypes.end());

  auto refreshPromise = auth->refreshToken();
  lastRefreshPromise->resolve(makeTokens("new-token", "id"));
  assert(refreshPromise->isResolved());
  assert(std::find(eventTypes.begin(), eventTypes.end(), AuthEventType::TOKENS_REFRESHED) != eventTypes.end());

  auth->logout();
  assert(std::find(eventTypes.begin(), eventTypes.end(), AuthEventType::LOGOUT) != eventTypes.end());
}

void testLoginFailedEventCarriesTypedErrorCode() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  std::optional<AuthErrorCode> failedCode;
  std::optional<AuthProvider> failedProvider;

  auth->onAuthEvent([&](const AuthEvent& event) {
    if (event.type == AuthEventType::LOGIN_FAILED) {
      failedCode = event.errorCode;
      failedProvider = event.provider;
    }
  });

  auto loginPromise = auth->login(AuthProvider::MICROSOFT, std::nullopt);
  lastLoginPromise->reject(makeAuthError(AuthErrorCode::CANCELLED, "user closed the browser"));
  assert(loginPromise->isRejected());
  assert(failedProvider == AuthProvider::MICROSOFT);
  assert(failedCode == AuthErrorCode::CANCELLED);

  auto refreshPromise = auth->refreshToken();
  lastRefreshPromise->reject(makeAuthError(AuthErrorCode::REFRESH_FAILED, "invalid_grant"));
  assert(refreshPromise->isRejected());
}

void testRefreshFailedEventCarriesTypedErrorCode() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  std::optional<AuthErrorCode> failedCode;
  int refreshFailedEvents = 0;

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "old", expiredTimestampMs()));
  assert(loginPromise->isResolved());

  auth->onAuthEvent([&](const AuthEvent& event) {
    if (event.type == AuthEventType::REFRESH_FAILED) {
      refreshFailedEvents++;
      failedCode = event.errorCode;
    }
  });

  auto refreshPromise = auth->refreshToken();
  lastRefreshPromise->reject(makeAuthError(AuthErrorCode::NETWORK_ERROR, "connection refused"));
  assert(refreshPromise->isRejected());
  assert(refreshFailedEvents == 1);
  assert(failedCode == AuthErrorCode::NETWORK_ERROR);
}

void testDisposeRejectsPendingWorkAndClearsListeners() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  int listenerCalls = 0;
  int eventCalls = 0;
  bool didDisposeEvent = false;

  auth->onAuthStateChanged([&listenerCalls](const std::optional<AuthUser>&) {
    listenerCalls++;
  });
  auth->onAuthEvent([&](const AuthEvent& event) {
    eventCalls++;
    if (event.type == AuthEventType::DISPOSE) {
      didDisposeEvent = true;
    }
  });

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  auto restorePromise = auth->silentRestore();
  auto refreshPromise = auth->refreshToken();

  auth->dispose();

  assert(loginPromise->isRejected());
  assert(restorePromise->isRejected());
  assert(refreshPromise->isRejected());
  assert(didDisposeEvent);
  assert(didLogout);

  int callsBefore = listenerCalls + eventCalls;
  assert(!auth->getCurrentUser().has_value());
  assert(listenerCalls + eventCalls == callsBefore);
}

void testRevokeScopesPreservesVoidContract() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email", "profile"}));
  assert(loginPromise->isResolved());

  auto revokePromise = auth->revokeScopes({"profile", "missing", "profile"});
  assert(revokePromise->isResolved());
  const std::vector<std::string> remaining{"email"};
  assert(auth->getGrantedScopes() == remaining);
}

void testAuthErrorEnvelopeIsByteIdentical() {
  assert(std::string(AuthException(AuthErrorCode::CANCELLED).what()) == "cancelled");
  assert(formatAuthErrorEnvelope(AuthErrorCode::NETWORK_ERROR, "connection refused") == "network_error: connection refused");
  assert(formatAuthErrorEnvelope(AuthErrorCode::CANCELLED, "user closed the browser") == "cancelled: user closed the browser");
  assert(formatAuthErrorEnvelope(AuthErrorCode::UNKNOWN, std::nullopt) == "unknown");
  assert(formatAuthErrorEnvelope(AuthErrorCode::UNKNOWN, "") == "unknown");
  assert(authErrorCodeFromInt(1) == AuthErrorCode::CANCELLED);
  assert(authErrorCodeFromInt(-1) == AuthErrorCode::UNKNOWN);
  assert(authErrorCodeFromInt(16) == AuthErrorCode::UNKNOWN);

  try {
    std::rethrow_exception(makeAuthError(AuthErrorCode::CANCELLED, "user closed the browser"));
  } catch (const std::exception& e) {
    assert(std::string(e.what()) == "cancelled: user closed the browser");
  }
  try {
    std::rethrow_exception(makeAuthError(AuthErrorCode::NOT_SIGNED_IN));
  } catch (const AuthException& e) {
    assert(e.code() == AuthErrorCode::NOT_SIGNED_IN);
    assert(std::string(e.what()) == "not_signed_in");
  }
}

void testSessionScenariosInterleaveWithoutUnresolvedPromises() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  // SC-05: dispose rejects a pending login.
  auto pendingLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  auth->dispose();
  assert(pendingLogin->isRejected());

  // SC-09: a new login cancels the pending one; the duplicate settles when
  // its platform operation settles (the platform rejects it with
  // operation_in_progress; the mock resolves normally).
  auto first = auth->login(AuthProvider::GOOGLE, std::nullopt);
  auto second = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(first->isRejected());
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "second"));
  assert(second->isResolved());
  assert(auth->getCurrentUser()->accessToken == "second");

  // SC-03/SC-04: logout cancels in-flight refresh and clears the session.
  auto fresh = std::make_shared<HybridAuth>();
  auto loginPromise = fresh->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "old"));
  assert(loginPromise->isResolved());
  auto refreshPromise = fresh->refreshToken();
  fresh->logout();
  assert(refreshPromise->isRejected());
  assert(!fresh->getCurrentUser().has_value());
  assert(fresh->getGrantedScopes().empty());
}

} // namespace

int main() {
  testScopeMergesAndRemovals();
  testListenerExceptionsDoNotBlockStateUpdates();
  testRefreshCancelledWhenSessionChanges();
  testNewLoginReleasesStalePlatformSlotBeforeReplacementStarts();
  testLoginStartInvalidatesSilentRestore();
  testPendingLoginCancelledWhenSessionChanges();
  testRevokeAccessRequiresSession();
  testRevokeAccessClearsSessionOnlyAfterProviderRevocation();
  testLogoutCancelsPendingRevokeAccess();
  testNewLoginReleasesPendingRevokeBeforeReplacementStarts();
  testLogoutCancelsRefreshAndClearsSession();
  testSynchronousAccessorsAndListenerUnsubscribe();
  testSilentRestoreResolvedEmptyAndRejectedPaths();
  testLoginScopeFallbackAndRejectionPaths();
  testScopeRejectionAndNoUserRevokePaths();
  testAccessTokenReadRefreshAndFallbackPaths();
  testRefreshTokenSuccessFailureAndTokenListenerPaths();
  testTypedAuthEventsAcrossLoginRefreshLogout();
  testLoginFailedEventCarriesTypedErrorCode();
  testRefreshFailedEventCarriesTypedErrorCode();
  testAuthErrorEnvelopeIsByteIdentical();
  testDisposeRejectsPendingWorkAndClearsListeners();
  testRevokeScopesPreservesVoidContract();
  testSessionScenariosInterleaveWithoutUnresolvedPromises();

  std::cout << "HybridAuth tests passed!" << std::endl;
  return 0;
}

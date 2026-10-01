#include <algorithm>
#include <atomic>
#include <cassert>
#include <chrono>
#include <functional>
#include <thread>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>
#include "../HybridAuth.hpp"
#include "../PlatformAuth.hpp"
#include "../AuthError.hpp"
#include "../TokenExpiration.hpp"
#include <limits>

using namespace margelo::nitro::NitroAuth;

void testProviderExpirationTimestamps() {
  validateExpiration(std::nullopt);
  validateExpiration(0);
  validateExpiration(1789500000123.456);
  for (double invalid : {-1.0, std::numeric_limits<double>::infinity(),
                         -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    bool rejected = false;
    try { validateExpiration(invalid); }
    catch (const AuthException& error) { rejected = std::string(error.what()).find("parse_error") != std::string::npos; }
    assert(rejected);
  }
}

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
bool failLogout = false;
bool keepCancelledLoginPending = false;
bool keepCancelledPlatformPending = false;
std::function<void()> onPlatformInvalidate;
bool deferNonce = false;
std::shared_ptr<Promise<AuthNonce>> lastNoncePromise;
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
  failLogout = false;
  keepCancelledLoginPending = false;
  keepCancelledPlatformPending = false;
  onPlatformInvalidate = nullptr;
  deferNonce = false;
  lastNoncePromise = nullptr;
  didRevokeAccess = false;
  platformCancellationCount = 0;
  platformInvalidationCount = 0;
}

} // namespace

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider, const std::optional<LoginOptions>&) {
  lastLoginPromise = Promise<AuthUser>::create();
  return lastLoginPromise;
}

std::shared_ptr<Promise<AuthNonce>> PlatformAuth::createNonce() {
  auto promise = Promise<AuthNonce>::create();
  lastNoncePromise = promise;
  if (deferNonce) return promise;
  AuthNonce nonce;
  nonce.raw = "raw-test-nonce";
  nonce.hashed = std::string(64, 'a');
  promise->resolve(nonce);
  return promise;
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
  if (onPlatformInvalidate) {
    auto hook = std::move(onPlatformInvalidate);
    onPlatformInvalidate = nullptr;
    hook();
  }
}

void PlatformAuth::cancelPendingOperations(AuthErrorCode reason) {
  platformCancellationCount++;
  if (keepCancelledPlatformPending) return;
  const auto cancellation = makeAuthError(reason);
  if (!keepCancelledLoginPending && lastLoginPromise && lastLoginPromise->isPending()) lastLoginPromise->reject(cancellation);
  if (lastRequestScopesPromise && lastRequestScopesPromise->isPending()) lastRequestScopesPromise->reject(cancellation);
  if (lastRefreshPromise && lastRefreshPromise->isPending()) lastRefreshPromise->reject(cancellation);
  if (lastSilentRestorePromise && lastSilentRestorePromise->isPending()) lastSilentRestorePromise->reject(cancellation);
  if (lastRevokeAccessPromise && lastRevokeAccessPromise->isPending()) lastRevokeAccessPromise->reject(cancellation);
}

void PlatformAuth::logout() {
  didLogout = true;
  if (failLogout) throw AuthException(AuthErrorCode::CONFIGURATION_ERROR);
}

std::shared_ptr<Promise<void>> PlatformAuth::revokeAccess(AuthProvider provider) {
  didRevokeAccess = true;
  lastRevokedProvider = provider;
  lastRevokeAccessPromise = Promise<void>::create();
  return lastRevokeAccessPromise;
}

} // namespace margelo::nitro::NitroAuth

namespace {

void testAppleSessionNeverUsesAnotherProvidersRefreshOrScopeFlow() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto login = auth->login(AuthProvider::APPLE, std::nullopt);
  auto apple = makeUser(std::vector<std::string>{"email"});
  apple.provider = AuthProvider::APPLE;
  apple.idToken = "apple-id-token";
  apple.authorizationCode = "apple-authorization-code";
  lastLoginPromise->resolve(apple);
  assert(login->isResolved());
  const auto cancellations = platformCancellationCount;
  const auto invalidations = platformInvalidationCount;

  assert(auth->refreshToken()->isRejected());
  assert(auth->requestScopes({"fullName"})->isRejected());
  assert(lastRefreshPromise == nullptr);
  assert(lastRequestScopesPromise == nullptr);
  assert(platformCancellationCount == cancellations);
  assert(platformInvalidationCount == invalidations);
  assert(auth->getCurrentUser()->provider == AuthProvider::APPLE);
  assert(auth->getCurrentUser()->authorizationCode == apple.authorizationCode);
  assert(auth->getCurrentUser()->idToken == apple.idToken);
}

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

void testNonceGenerationDelegatesToPlatform() {
  auto auth = std::make_shared<HybridAuth>();
  auto promise = auth->createNonce();
  assert(promise->isResolved());
  assert(promise->getResult().raw == "raw-test-nonce");
  assert(promise->getResult().hashed == std::string(64, 'a'));
}

void testStructuredNamesRemainAvailableOnTheUser() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto user = makeUser();
  user.firstName = "Jane";
  user.lastName = "Doe";

  auto promise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(user);

  assert(promise->isResolved());
  assert(auth->getCurrentUser()->firstName == "Jane");
  assert(auth->getCurrentUser()->lastName == "Doe");
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
  assert(platformCancellationCount == 2);
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

void testDisposeRejectsPendingLoginAndClearsListeners() {
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

  keepCancelledLoginPending = true;
  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(loginPromise->isPending());

  auth->dispose();

  assert(loginPromise->isRejected());
  assert(didDisposeEvent);
  assert(didLogout);

  int callsBefore = listenerCalls + eventCalls;
  assert(!auth->getCurrentUser().has_value());
  assert(listenerCalls + eventCalls == callsBefore);
}

void testDisposeRejectsPendingSilentRestore() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto restorePromise = auth->silentRestore();
  assert(restorePromise->isPending());

  auth->dispose();

  assert(restorePromise->isRejected());
}

void testDisposeRejectsPendingRequestScopes() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "token"));
  assert(loginPromise->isResolved());

  auto scopesPromise = auth->requestScopes({"email"});
  assert(scopesPromise->isPending());

  auth->dispose();

  assert(scopesPromise->isRejected());
}

void testDisposeRejectsPendingRefresh() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "token"));
  assert(loginPromise->isResolved());

  auto refreshPromise = auth->refreshToken();
  assert(refreshPromise->isPending());

  auth->dispose();

  assert(refreshPromise->isRejected());
}

void testRefreshDoesNotCancelPendingSessionOperations() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto firstLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "token", expiredTimestampMs()));
  assert(firstLogin->isResolved());

  auto scopesPromise = auth->requestScopes({"email"});
  auto platformScopes = lastRequestScopesPromise;
  const auto cancellations = platformCancellationCount;
  auto refreshDuringScopes = auth->refreshToken();
  assert(refreshDuringScopes->isRejected());
  bool refreshReportedInProgress = false;
  try { std::rethrow_exception(refreshDuringScopes->getError()); }
  catch (const AuthException& error) { refreshReportedInProgress = error.code() == AuthErrorCode::OPERATION_IN_PROGRESS; }
  assert(refreshReportedInProgress);
  auto accessDuringScopes = auth->getAccessToken();
  assert(accessDuringScopes->isRejected());
  assert(scopesPromise->isPending());
  assert(platformScopes->isPending());
  assert(lastRefreshPromise == nullptr);
  assert(platformCancellationCount == cancellations);
  platformScopes->resolve(makeUser(std::vector<std::string>{"profile", "email"}, "token"));
  assert(scopesPromise->isResolved());

  auto switchLogin = auth->login(AuthProvider::GOOGLE, std::nullopt);
  auto platformLogin = lastLoginPromise;
  auto refreshDuringLogin = auth->refreshToken();
  assert(refreshDuringLogin->isRejected());
  assert(switchLogin->isPending());
  assert(platformLogin->isPending());
  platformLogin->resolve(makeUser(std::vector<std::string>{"profile"}, "switched"));
  assert(switchLogin->isResolved());
  assert(auth->getCurrentUser()->accessToken == "switched");

  auto restorePromise = auth->silentRestore();
  auto platformRestore = lastSilentRestorePromise;
  auto refreshDuringRestore = auth->refreshToken();
  assert(refreshDuringRestore->isRejected());
  assert(restorePromise->isPending());
  assert(platformRestore->isPending());
  platformRestore->resolve(makeUser(std::vector<std::string>{"profile"}, "restored"));
  assert(restorePromise->isResolved());
  assert(auth->getCurrentUser()->accessToken == "restored");
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

void testCredentialTransactionDoesNotPublishSession() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  int states = 0;
  auth->onAuthStateChanged([&](const std::optional<AuthUser>&) { states++; });
  auto pending = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  assert(pending->isPending());
  auto duplicate = auth->getCredential(CredentialProvider::APPLE, std::nullopt);
  assert(duplicate->isRejected());
  auto login = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(login->isRejected());
  auto user = makeUser(std::vector<std::string>{"email"}, "access");
  user.idToken = "provider-id-token";
  lastLoginPromise->resolve(user);
  assert(pending->isResolved());
  assert(pending->getResult().idToken == "provider-id-token");
  assert(pending->getResult().nonce == "raw-test-nonce");
  assert(!auth->getCurrentUser());
  assert(states == 0);
  assert(didLogout);
}

void testCredentialCancellationAndActiveSession() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto credential = auth->getCredential(CredentialProvider::APPLE, std::nullopt);
  auth->logout();
  assert(credential->isRejected());
  auto login = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email"}, "session"));
  auto rejected = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  assert(rejected->isRejected());
  assert(auth->getCurrentUser()->accessToken == "session");
}

void testAtomicResultsAndSnapshots() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  std::vector<AuthSessionSnapshot> snapshots;
  auto remove = auth->onSessionChanged([&](const AuthSessionSnapshot& snapshot) { snapshots.push_back(snapshot); });
  const auto initial = auth->getSessionSnapshot();
  auto login = auth->loginAndGetUser(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email", "profile"}, "original"));
  assert(login->isResolved());
  const auto signedIn = auth->getSessionSnapshot();
  assert(signedIn.revision > initial.revision);
  assert(signedIn.user->scopes == signedIn.scopes);
  auto revoked = auth->revokeScopesWithResult({"email", "email", "absent"});
  assert(revoked->getResult().revokedScopes == std::vector<std::string>{"email"});
  assert(!revoked->getResult().revokedAtProvider);
  auth->logout();
  assert(login->getResult().accessToken == "original");
  assert(!snapshots.back().user);
  remove();
  remove();

  LoginOptions emptyScopes;
  emptyScopes.scopes = std::vector<std::string>{};
  auto emptyLogin = auth->loginAndGetUser(AuthProvider::GOOGLE, emptyScopes);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{}, "empty"));
  assert(emptyLogin->isResolved());
  assert(emptyLogin->getResult().scopes == auth->getCurrentUser()->scopes);
  assert(!emptyLogin->getResult().scopes.has_value());

  LoginOptions requestedScopes;
  requestedScopes.scopes = std::vector<std::string>{"email"};
  auto requestedLogin = auth->loginAndGetUser(AuthProvider::GOOGLE, requestedScopes);
  lastLoginPromise->resolve(makeUser(std::nullopt, "requested"));
  assert(requestedLogin->getResult().scopes == auth->getCurrentUser()->scopes);
  assert(requestedLogin->getResult().scopes == std::vector<std::string>{"email"});
}


void testCredentialFailureCleanupAndStaleResults() {
  for (bool cleanupFails : {false, true}) {
    resetPlatformMocks();
    auto auth = std::make_shared<HybridAuth>();
    auto pending = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
    failLogout = cleanupFails;
    lastLoginPromise->reject(makeAuthError(AuthErrorCode::NETWORK_ERROR));
    assert(didLogout && pending->isRejected());
    try { std::rethrow_exception(pending->getError()); }
    catch (const AuthException& error) { assert(error.code() == AuthErrorCode::NETWORK_ERROR); }
    assert(!auth->getCurrentUser());
  }
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto missingToken = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser());
  assert(missingToken->isRejected() && didLogout);
  auto cleanupFailure = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  auto user = makeUser(); user.idToken = "test-id-token";
  failLogout = true;
  lastLoginPromise->resolve(user);
  assert(cleanupFailure->isRejected());
  failLogout = false;
  auto stale = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  auto oldProvider = lastLoginPromise;
  keepCancelledLoginPending = true;
  auth->logout();
  auto session = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email"}, "new-session"));
  didLogout = false;
  oldProvider->resolve(user);
  assert(stale->isRejected() && session->isResolved());
  assert(!didLogout && auth->getCurrentUser()->accessToken == "new-session");
}

void testCredentialNonceValidationAndCancellation() {
  resetPlatformMocks();
  deferNonce = true;
  auto auth = std::make_shared<HybridAuth>();
  auto invalid = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  AuthNonce bad; bad.raw = "test"; bad.hashed = "invalid";
  lastNoncePromise->resolve(bad);
  assert(invalid->isRejected() && !lastLoginPromise && !didLogout);
  auto cancelled = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  auto nonce = lastNoncePromise;
  auth->logout();
  AuthNonce valid; valid.raw = "test"; valid.hashed = std::string(64, 'a');
  nonce->resolve(valid);
  assert(cancelled->isRejected() && !lastLoginPromise);
  auto failed = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  lastNoncePromise->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR));
  assert(failed->isRejected() && !lastLoginPromise);
}

namespace {

template <typename T>
AuthErrorCode rejectionCodeOf(const std::shared_ptr<Promise<T>>& promise) {
  assert(promise->isRejected());
  try {
    std::rethrow_exception(promise->getError());
  } catch (const AuthException& error) {
    return error.code();
  } catch (...) {
    assert(false && "rejection must be an AuthException");
  }
  return AuthErrorCode::UNKNOWN;
}

std::shared_ptr<HybridAuth> signedInAuth(const AuthUser& user) {
  auto auth = std::make_shared<HybridAuth>();
  auto login = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(user);
  assert(login->isResolved());
  return auth;
}

void testErrorCodeNamesMatchTheJsUnionForEveryCode() {
  const std::vector<std::string> names = {
    "refresh_failed", "cancelled", "interaction_required", "timeout", "popup_blocked", "network_error",
    "configuration_error", "not_signed_in", "operation_in_progress", "unsupported_provider", "invalid_state",
    "invalid_nonce", "token_error", "no_id_token", "parse_error", "unknown",
  };
  for (int value = 0; value < static_cast<int>(names.size()); ++value) {
    const auto code = authErrorCodeFromInt(value);
    assert(static_cast<int>(code) == value);
    assert(authErrorCodeName(code) == names[value]);
    assert(std::string(AuthException(code).what()) == names[value]);
    assert(formatAuthErrorEnvelope(code, "detail") == names[value] + ": detail");
    try { std::rethrow_exception(makeAuthError(code)); }
    catch (const AuthException& error) { assert(error.code() == code && error.what() == names[value]); }
  }
  for (int invalid : {-1, 16, 17, 255, std::numeric_limits<int>::max(), std::numeric_limits<int>::min()}) {
    assert(authErrorCodeFromInt(invalid) == AuthErrorCode::UNKNOWN);
  }
  assert(std::string(authErrorCodeName(static_cast<AuthErrorCode>(99))) == "unknown");
}

void testSecondSignInWhileFirstPendingSettlesFirstExactlyOnce() {
  resetPlatformMocks();
  keepCancelledPlatformPending = true;
  auto auth = std::make_shared<HybridAuth>();
  auto first = auth->loginAndGetUser(AuthProvider::GOOGLE, std::nullopt);
  auto firstPlatform = lastLoginPromise;
  auto second = auth->loginAndGetUser(AuthProvider::GOOGLE, std::nullopt);
  auto secondPlatform = lastLoginPromise;
  assert(rejectionCodeOf(first) == AuthErrorCode::CANCELLED);
  assert(second->isPending());

  firstPlatform->reject(makeAuthError(AuthErrorCode::NETWORK_ERROR));
  assert(rejectionCodeOf(first) == AuthErrorCode::CANCELLED);
  assert(second->isPending());

  auto third = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(rejectionCodeOf(second) == AuthErrorCode::CANCELLED);
  secondPlatform->resolve(makeUser(std::vector<std::string>{"email"}, "stale"));
  assert(!auth->getCurrentUser());
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email"}, "current"));
  assert(third->isResolved());
  assert(auth->getCurrentUser()->accessToken == "current");
}

void testLateProviderResultsAfterCancellationNeverResettle() {
  resetPlatformMocks();
  keepCancelledPlatformPending = true;
  auto auth = std::make_shared<HybridAuth>();
  int states = 0;
  int refreshedEvents = 0;
  int refreshFailedEvents = 0;
  auth->onAuthStateChanged([&](const std::optional<AuthUser>&) { states++; });
  auth->onAuthEvent([&](const AuthEvent& event) {
    if (event.type == AuthEventType::TOKENS_REFRESHED) refreshedEvents++;
    if (event.type == AuthEventType::REFRESH_FAILED) refreshFailedEvents++;
  });
  const auto user = makeUser(std::vector<std::string>{"email"}, "token");

  auto login = auth->login(AuthProvider::GOOGLE, std::nullopt);
  auto platformLogin = lastLoginPromise;
  auth->logout();
  assert(rejectionCodeOf(login) == AuthErrorCode::CANCELLED);
  int settledStates = states;
  platformLogin->resolve(user);
  assert(!auth->getCurrentUser() && states == settledStates);
  assert(rejectionCodeOf(login) == AuthErrorCode::CANCELLED);

  auto restore = auth->silentRestore();
  auto platformRestore = lastSilentRestorePromise;
  auth->logout();
  assert(rejectionCodeOf(restore) == AuthErrorCode::CANCELLED);
  settledStates = states;
  platformRestore->resolve(user);
  assert(!auth->getCurrentUser() && states == settledStates);
  assert(rejectionCodeOf(restore) == AuthErrorCode::CANCELLED);

  auto signIn = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(user);
  assert(signIn->isResolved());
  auto scopes = auth->requestScopes({"profile"});
  auto platformScopes = lastRequestScopesPromise;
  auth->logout();
  assert(rejectionCodeOf(scopes) == AuthErrorCode::CANCELLED);
  settledStates = states;
  platformScopes->resolve(user);
  assert(!auth->getCurrentUser() && auth->getGrantedScopes().empty() && states == settledStates);

  signIn = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(user);
  auto revoke = auth->revokeAccess();
  auto platformRevoke = lastRevokeAccessPromise;
  auto replacement = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(rejectionCodeOf(revoke) == AuthErrorCode::CANCELLED);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email"}, "replacement"));
  assert(replacement->isResolved());
  platformRevoke->resolve();
  assert(auth->getCurrentUser()->accessToken == "replacement");

  auto refresh = auth->refreshToken();
  auto platformRefresh = lastRefreshPromise;
  auth->logout();
  assert(rejectionCodeOf(refresh) == AuthErrorCode::NOT_SIGNED_IN);
  platformRefresh->resolve(makeTokens("late-token"));
  assert(!auth->getCurrentUser() && refreshedEvents == 0);
  assert(rejectionCodeOf(refresh) == AuthErrorCode::NOT_SIGNED_IN);

  signIn = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(user);
  refresh = auth->refreshToken();
  platformRefresh = lastRefreshPromise;
  auth->dispose();
  assert(rejectionCodeOf(refresh) == AuthErrorCode::CANCELLED);
  platformRefresh->reject(makeAuthError(AuthErrorCode::NETWORK_ERROR));
  assert(rejectionCodeOf(refresh) == AuthErrorCode::CANCELLED);
  assert(refreshFailedEvents == 0);
}

void testListenersMayReenterWithoutDeadlockOrDoubleSettlement() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  bool didLogoutFromListener = false;
  auth->onAuthStateChanged([&](const std::optional<AuthUser>& user) {
    if (user && !didLogoutFromListener) {
      didLogoutFromListener = true;
      auth->logout();
    }
  });
  auto result = auth->loginAndGetUser(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email"}, "token"));
  assert(didLogoutFromListener);
  assert(result->isResolved() && result->getResult().accessToken == "token");
  assert(!auth->getCurrentUser());

  resetPlatformMocks();
  auto reentrant = signedInAuth(makeUser(std::vector<std::string>{"email"}, "token"));
  std::shared_ptr<Promise<AuthTokens>> nested;
  int tokenCalls = 0;
  std::function<void()> removeSelf;
  int selfCalls = 0;
  int addedCalls = 0;
  reentrant->onTokensRefreshed([&](const AuthTokens&) {
    tokenCalls++;
    if (!nested) nested = reentrant->refreshToken();
    assert(reentrant->getCurrentUser().has_value());
    assert(!reentrant->getGrantedScopes().empty());
  });
  removeSelf = reentrant->onSessionChanged([&](const AuthSessionSnapshot&) {
    selfCalls++;
    removeSelf();
    reentrant->onSessionChanged([&](const AuthSessionSnapshot&) { addedCalls++; });
  });
  auto refresh = reentrant->refreshToken();
  auto outerPlatform = lastRefreshPromise;
  outerPlatform->resolve(makeTokens("refreshed"));
  assert(refresh->isResolved() && refresh->getResult().accessToken == "refreshed");
  assert(nested && nested != refresh && nested->isPending());
  assert(lastRefreshPromise != outerPlatform);
  lastRefreshPromise->resolve(makeTokens("nested"));
  assert(nested->isResolved());
  assert(tokenCalls == 2);
  assert(selfCalls == 1);
  assert(addedCalls == 1);
  assert(reentrant->getCurrentUser()->accessToken == "nested");
}

void testUnsubscribeAfterDisposeAndAfterDestruction() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  int calls = 0;
  auto removeState = auth->onAuthStateChanged([&](const std::optional<AuthUser>&) { calls++; });
  auto removeTokens = auth->onTokensRefreshed([&](const AuthTokens&) { calls++; });
  auto removeEvent = auth->onAuthEvent([&](const AuthEvent&) { calls++; });
  auto removeSnapshot = auth->onSessionChanged([&](const AuthSessionSnapshot&) { calls++; });
  removeEvent();
  removeEvent();

  auth->dispose();
  auth->dispose();
  const int afterDispose = calls;
  removeState();
  removeTokens();
  removeSnapshot();

  auto login = auth->login(AuthProvider::GOOGLE, std::nullopt);
  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email"}, "after-dispose"));
  assert(login->isResolved());
  assert(auth->getCurrentUser()->accessToken == "after-dispose");
  assert(calls == afterDispose);

  auto lateState = auth->onAuthStateChanged([&](const std::optional<AuthUser>&) { calls++; });
  auto lateSnapshot = auth->onSessionChanged([&](const AuthSessionSnapshot&) { calls++; });
  auto lateTokens = auth->onTokensRefreshed([&](const AuthTokens&) { calls++; });
  auto lateEvent = auth->onAuthEvent([&](const AuthEvent&) { calls++; });
  resetPlatformMocks();
  auth.reset();
  lateState();
  lateSnapshot();
  lateTokens();
  lateEvent();
  removeState();
  assert(calls == afterDispose);
}

void testCredentialRejectsProviderMismatchAndMalformedNonces() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  auto mismatch = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  auto apple = makeUser();
  apple.provider = AuthProvider::APPLE;
  apple.idToken = "apple-id-token";
  lastLoginPromise->resolve(apple);
  assert(rejectionCodeOf(mismatch) == AuthErrorCode::INVALID_STATE);
  assert(didLogout && !auth->getCurrentUser());

  auto emptyToken = auth->getCredential(CredentialProvider::APPLE, std::nullopt);
  apple.idToken = "";
  lastLoginPromise->resolve(apple);
  assert(rejectionCodeOf(emptyToken) == AuthErrorCode::NO_ID_TOKEN);

  resetPlatformMocks();
  deferNonce = true;
  const std::vector<AuthNonce> malformed = {
    AuthNonce("", std::string(64, 'a')),
    AuthNonce("raw", ""),
    AuthNonce("raw", std::string(63, 'a')),
    AuthNonce("raw", std::string(65, 'a')),
    AuthNonce("raw", std::string(64, 'A')),
    AuthNonce("raw", std::string(63, 'a') + "g"),
    AuthNonce("raw", std::string(63, 'a') + std::string(1, '\0')),
    AuthNonce("raw", std::string(1 << 20, 'a')),
  };
  for (const auto& nonce : malformed) {
    auto credential = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
    lastNoncePromise->resolve(nonce);
    assert(rejectionCodeOf(credential) == AuthErrorCode::INVALID_NONCE);
    assert(!lastLoginPromise);
  }
  auto afterFailures = auth->getCredential(CredentialProvider::GOOGLE, std::nullopt);
  lastNoncePromise->resolve(AuthNonce("raw", std::string(64, '0')));
  assert(afterFailures->isPending() && lastLoginPromise);
  auth->logout();
  assert(rejectionCodeOf(afterFailures) == AuthErrorCode::CANCELLED);
}

void testRevokeAccessWhenInvalidationEndsTheSession() {
  resetPlatformMocks();
  auto auth = signedInAuth(makeUser(std::vector<std::string>{"email"}, "token"));
  onPlatformInvalidate = [&] { auth->logout(); };
  auto revoke = auth->revokeAccess();
  assert(rejectionCodeOf(revoke) == AuthErrorCode::NOT_SIGNED_IN);
  assert(!didRevokeAccess && !lastRevokeAccessPromise);
  assert(!auth->getCurrentUser());
}

void testAccessTokenExpiryMathAtNumericBoundaries() {
  const auto nowMs = static_cast<double>(std::chrono::system_clock::now().time_since_epoch() / std::chrono::milliseconds(1));
  for (double expired : {0.0, 1.0, 2147483647.0, 4294967295.0, 4294967296.0, nowMs - 86400000.0, nowMs + 60000.0}) {
    resetPlatformMocks();
    auto auth = signedInAuth(makeUser(std::vector<std::string>{"email"}, "cached", expired));
    auto token = auth->getAccessToken();
    assert(token->isPending() && lastRefreshPromise);
    lastRefreshPromise->resolve(makeTokens("fresh", std::nullopt, std::nullopt, nowMs + 3600000.0));
    assert(token->isResolved() && token->getResult() == "fresh");
    assert(auth->getCurrentUser()->expirationTime == nowMs + 3600000.0);
    resetPlatformMocks();
    auto cached = auth->getAccessToken();
    assert(cached->isResolved() && cached->getResult() == "fresh" && !lastRefreshPromise);
  }
  for (double valid : {nowMs + 3600000.0, 4102444800000.0, 9007199254740992.0, std::numeric_limits<double>::max(),
                       std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    resetPlatformMocks();
    auto auth = signedInAuth(makeUser(std::vector<std::string>{"email"}, "cached", valid));
    resetPlatformMocks();
    auto token = auth->getAccessToken();
    assert(token->isResolved() && token->getResult() == "cached" && !lastRefreshPromise);
  }
}

void testLargeScopeBatchesAndManyListeners() {
  resetPlatformMocks();
  std::vector<std::string> granted;
  std::vector<std::string> requested;
  for (int index = 0; index < 20000; ++index) granted.push_back("scope-" + std::to_string(index));
  for (int index = 10000; index < 30000; ++index) requested.push_back("scope-" + std::to_string(index));
  requested.insert(requested.end(), granted.begin(), granted.begin() + 100);
  auto auth = signedInAuth(makeUser(granted, "token"));
  assert(auth->getGrantedScopes() == granted);

  auto scopes = auth->requestScopes(requested);
  lastRequestScopesPromise->resolve(makeUser(std::nullopt, "token"));
  assert(scopes->isResolved());
  const auto merged = auth->getGrantedScopes();
  assert(merged.size() == 30000);
  assert(merged.front() == "scope-0" && merged[19999] == "scope-19999" && merged.back() == "scope-29999");
  assert(auth->getCurrentUser()->scopes == merged);

  auto revoked = auth->revokeScopesWithResult(requested);
  assert(revoked->getResult().revokedScopes.size() == 20100);
  assert(auth->getGrantedScopes().size() == 9900);
  auto rest = auth->revokeScopesWithResult(granted);
  assert(rest->getResult().revokedScopes.size() == 9900);
  assert(auth->getGrantedScopes().empty());
  auto none = auth->revokeScopesWithResult({});
  assert(none->getResult().revokedScopes.empty());

  int calls = 0;
  std::vector<std::function<void()>> removers;
  for (int index = 0; index < 2000; ++index) {
    removers.push_back(auth->onAuthStateChanged([&](const std::optional<AuthUser>&) { calls++; }));
    removers.push_back(auth->onSessionChanged([&](const AuthSessionSnapshot&) { calls++; }));
  }
  auth->revokeScopesWithResult({});
  assert(calls == 4000);
  for (const auto& remove : removers) remove();
  auth->revokeScopesWithResult({});
  assert(calls == 4000);
}

void testConcurrentCallersDuringSessionChanges() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();
  std::atomic<bool> stop{false};
  std::atomic<int> notifications{0};
  std::atomic<int> inconsistencies{0};
  std::atomic<int> iterations{0};
  std::vector<std::thread> threads;
  for (int index = 0; index < 6; ++index) {
    threads.emplace_back([&, index] {
      while (!stop.load()) {
        const auto snapshot = auth->getSessionSnapshot();
        if (snapshot.user && snapshot.user->scopes.value_or(std::vector<std::string>{}) != snapshot.scopes) inconsistencies++;
        if (!snapshot.user && !snapshot.scopes.empty()) inconsistencies++;
        auth->getCurrentUser();
        auth->getGrantedScopes();
        auto removeSnapshot = auth->onSessionChanged([&](const AuthSessionSnapshot&) { notifications++; });
        auto removeState = auth->onAuthStateChanged([&](const std::optional<AuthUser>&) { notifications++; });
        auto removeTokens = auth->onTokensRefreshed([&](const AuthTokens&) { notifications++; });
        auto removeEvent = auth->onAuthEvent([&](const AuthEvent&) { notifications++; });
        if (index % 2 == 0) auth->revokeScopesWithResult({"profile"});
        removeSnapshot();
        removeState();
        removeTokens();
        removeEvent();
        iterations++;
      }
    });
  }
  for (int round = 0; round < 300; ++round) {
    auto login = auth->login(AuthProvider::GOOGLE, std::nullopt);
    lastLoginPromise->resolve(makeUser(std::vector<std::string>{"email", "profile"}, "token"));
    assert(login->isResolved() || login->isRejected());
    auto refresh = auth->refreshToken();
    if (lastRefreshPromise && lastRefreshPromise->isPending()) lastRefreshPromise->resolve(makeTokens("refreshed"));
    assert(!refresh->isPending());
    auth->logout();
    assert(!auth->getCurrentUser());
  }
  while (iterations.load() < 6) std::this_thread::yield();
  stop = true;
  for (auto& thread : threads) thread.join();
  assert(inconsistencies == 0);
  assert(!auth->getCurrentUser() && auth->getGrantedScopes().empty());
}

} // namespace

int main() {
  testProviderExpirationTimestamps();
  testCredentialNonceValidationAndCancellation();
  testCredentialFailureCleanupAndStaleResults();
  testCredentialTransactionDoesNotPublishSession();
  testCredentialCancellationAndActiveSession();
  testAtomicResultsAndSnapshots();
  testAppleSessionNeverUsesAnotherProvidersRefreshOrScopeFlow();
  testNonceGenerationDelegatesToPlatform();
  testStructuredNamesRemainAvailableOnTheUser();
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
  testDisposeRejectsPendingLoginAndClearsListeners();
  testDisposeRejectsPendingSilentRestore();
  testDisposeRejectsPendingRequestScopes();
  testDisposeRejectsPendingRefresh();
  testRefreshDoesNotCancelPendingSessionOperations();
  testRevokeScopesPreservesVoidContract();
  testSessionScenariosInterleaveWithoutUnresolvedPromises();
  testErrorCodeNamesMatchTheJsUnionForEveryCode();
  testSecondSignInWhileFirstPendingSettlesFirstExactlyOnce();
  testLateProviderResultsAfterCancellationNeverResettle();
  testListenersMayReenterWithoutDeadlockOrDoubleSettlement();
  testUnsubscribeAfterDisposeAndAfterDestruction();
  testCredentialRejectsProviderMismatchAndMalformedNonces();
  testRevokeAccessWhenInvalidationEndsTheSession();
  testAccessTokenExpiryMathAtNumericBoundaries();
  testLargeScopeBatchesAndManyListeners();
  testConcurrentCallersDuringSessionChanges();

  std::cout << "HybridAuth tests passed!" << std::endl;
  return 0;
}

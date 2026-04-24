#include <cassert>
#include <chrono>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>
#include "../HybridAuth.hpp"
#include "../PlatformAuth.hpp"

using namespace margelo::nitro::NitroAuth;

namespace margelo::nitro::NitroAuth {

void HybridAuthSpec::loadHybridMethods() {}

namespace {

std::shared_ptr<Promise<AuthUser>> lastLoginPromise;
std::shared_ptr<Promise<AuthUser>> lastRequestScopesPromise;
std::shared_ptr<Promise<AuthTokens>> lastRefreshPromise;
std::shared_ptr<Promise<std::optional<AuthUser>>> lastSilentRestorePromise;
bool didLogout = false;

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
  didLogout = false;
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

void PlatformAuth::logout() {
  didLogout = true;
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
  auto duplicateRefreshPromise = auth->refreshToken();
  assert(refreshPromise == duplicateRefreshPromise);

  auto replacementLoginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);
  assert(refreshPromise->isRejected());

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "new"));
  assert(replacementLoginPromise->isResolved());

  lastRefreshPromise->resolve(makeTokens("stale"));

  assert(auth->getCurrentUser()->accessToken == "new");
}

void testLoginStartInvalidatesSilentRestore() {
  resetPlatformMocks();
  auto auth = std::make_shared<HybridAuth>();

  auto restorePromise = auth->silentRestore();
  auto loginPromise = auth->login(AuthProvider::GOOGLE, std::nullopt);

  lastSilentRestorePromise->resolve(makeUser(std::vector<std::string>{"profile"}, "restored"));
  assert(restorePromise->isResolved());
  assert(!auth->getCurrentUser().has_value());

  lastLoginPromise->resolve(makeUser(std::vector<std::string>{"profile"}, "interactive"));
  assert(loginPromise->isResolved());
  assert(auth->getCurrentUser()->accessToken == "interactive");
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

  lastRefreshPromise->resolve(makeTokens("stale"));
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
  assert(rejectedRestore->isResolved());
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
  lastLoginPromise->reject(std::make_exception_ptr(std::runtime_error("cancelled")));
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

} // namespace

int main() {
  testScopeMergesAndRemovals();
  testListenerExceptionsDoNotBlockStateUpdates();
  testRefreshCancelledWhenSessionChanges();
  testLoginStartInvalidatesSilentRestore();
  testLogoutCancelsRefreshAndClearsSession();
  testSynchronousAccessorsAndListenerUnsubscribe();
  testSilentRestoreResolvedEmptyAndRejectedPaths();
  testLoginScopeFallbackAndRejectionPaths();
  testScopeRejectionAndNoUserRevokePaths();
  testAccessTokenReadRefreshAndFallbackPaths();
  testRefreshTokenSuccessFailureAndTokenListenerPaths();

  std::cout << "HybridAuth tests passed!" << std::endl;
  return 0;
}

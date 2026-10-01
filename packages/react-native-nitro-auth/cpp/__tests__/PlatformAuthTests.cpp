#include <atomic>
#include <cassert>
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include "../AuthError.hpp"
#include "../PlatformAuth.hpp"
#include "HybridNativeAuthAdapterSpec.hpp"
#include <NitroModules/HybridObjectRegistry.hpp>

using namespace margelo::nitro;
using namespace margelo::nitro::NitroAuth;

namespace margelo::nitro::NitroAuth {
void HybridNativeAuthAdapterSpec::loadHybridMethods() {}
}

namespace {

enum class RegistryMode { THROWS, RETURNS_NULL, RETURNS_WRONG_TYPE, RETURNS_ADAPTER };
enum class ThrowKind { NONE, AUTH, RUNTIME, NON_STD };
enum class Settle { DEFER, IMMEDIATE };

const std::vector<AuthErrorCode> kAllCodes = {
  AuthErrorCode::REFRESH_FAILED, AuthErrorCode::CANCELLED, AuthErrorCode::INTERACTION_REQUIRED,
  AuthErrorCode::TIMEOUT, AuthErrorCode::POPUP_BLOCKED, AuthErrorCode::NETWORK_ERROR,
  AuthErrorCode::CONFIGURATION_ERROR, AuthErrorCode::NOT_SIGNED_IN, AuthErrorCode::OPERATION_IN_PROGRESS,
  AuthErrorCode::UNSUPPORTED_PROVIDER, AuthErrorCode::INVALID_STATE, AuthErrorCode::INVALID_NONCE,
  AuthErrorCode::TOKEN_ERROR, AuthErrorCode::NO_ID_TOKEN, AuthErrorCode::PARSE_ERROR, AuthErrorCode::UNKNOWN,
};

class UnrelatedObject : public virtual HybridObject {
public:
  UnrelatedObject() : HybridObject("Unrelated") {}
};

class FakeAdapter : public HybridNativeAuthAdapterSpec {
public:
  FakeAdapter() : HybridObject(TAG) {}

  ThrowKind throwKind = ThrowKind::NONE;
  AuthErrorCode thrownCode = AuthErrorCode::NETWORK_ERROR;
  bool throwOnSyncMethods = false;
  Settle settle = Settle::DEFER;
  std::optional<ProviderUserResult> immediateUser;
  std::optional<AuthNonce> nonce;
  std::atomic<bool> playServices{true};
  std::atomic<int> hasPlayServicesCalls{0};
  int invalidateCalls = 0;
  int cancelCalls = 0;
  int logoutCalls = 0;
  std::optional<AuthProvider> lastProvider;
  std::optional<LoginOptions> lastOptions;
  std::vector<std::string> lastScopes;
  std::shared_ptr<Promise<ProviderUserResult>> lastUser;
  std::shared_ptr<Promise<ProviderTokenResult>> lastTokens;
  std::shared_ptr<Promise<ProviderVoidResult>> lastVoid;

  void reset() {
    throwKind = ThrowKind::NONE;
    thrownCode = AuthErrorCode::NETWORK_ERROR;
    throwOnSyncMethods = false;
    settle = Settle::DEFER;
    immediateUser = std::nullopt;
    nonce = std::nullopt;
    playServices = true;
    invalidateCalls = 0;
    cancelCalls = 0;
    logoutCalls = 0;
    lastProvider = std::nullopt;
    lastOptions = std::nullopt;
    lastScopes.clear();
    lastUser = nullptr;
    lastTokens = nullptr;
    lastVoid = nullptr;
  }

  void maybeThrow() const {
    switch (throwKind) {
      case ThrowKind::NONE: return;
      case ThrowKind::AUTH: throw AuthException(thrownCode, "adapter detail");
      case ThrowKind::RUNTIME: throw std::runtime_error("adapter exploded");
      case ThrowKind::NON_STD: throw 42;
    }
  }

  AuthNonce createNonce() override {
    maybeThrow();
    return nonce.value_or(AuthNonce("raw", std::string(64, 'a')));
  }
  std::shared_ptr<Promise<ProviderUserResult>> login(AuthProvider provider, const std::optional<LoginOptions>& options) override {
    maybeThrow();
    lastProvider = provider;
    lastOptions = options;
    return userPromise();
  }
  std::shared_ptr<Promise<ProviderUserResult>> requestScopes(const std::vector<std::string>& scopes) override {
    maybeThrow();
    lastScopes = scopes;
    return userPromise();
  }
  std::shared_ptr<Promise<ProviderTokenResult>> refreshToken() override {
    maybeThrow();
    lastTokens = Promise<ProviderTokenResult>::create();
    return lastTokens;
  }
  std::shared_ptr<Promise<ProviderUserResult>> silentRestore() override {
    maybeThrow();
    return userPromise();
  }
  std::shared_ptr<Promise<ProviderVoidResult>> revokeAccess(AuthProvider provider) override {
    maybeThrow();
    lastProvider = provider;
    lastVoid = Promise<ProviderVoidResult>::create();
    return lastVoid;
  }
  bool hasPlayServices() override {
    hasPlayServicesCalls++;
    if (throwOnSyncMethods) maybeThrow();
    return playServices;
  }
  void invalidatePendingOperations() override {
    invalidateCalls++;
    if (throwOnSyncMethods) maybeThrow();
  }
  void cancel() override {
    cancelCalls++;
    if (throwOnSyncMethods) maybeThrow();
  }
  void logout() override {
    logoutCalls++;
    if (throwOnSyncMethods) maybeThrow();
  }

private:
  std::shared_ptr<Promise<ProviderUserResult>> userPromise() {
    lastUser = Promise<ProviderUserResult>::create();
    if (settle == Settle::IMMEDIATE && immediateUser) lastUser->resolve(*immediateUser);
    return lastUser;
  }
};

RegistryMode registryMode = RegistryMode::THROWS;
std::atomic<int> registryCalls{0};
std::shared_ptr<FakeAdapter> fakeAdapter = std::make_shared<FakeAdapter>();

AuthUser makeUser(std::optional<double> expirationTime = std::nullopt) {
  AuthUser user;
  user.provider = AuthProvider::GOOGLE;
  user.email = "test@example.com";
  user.expirationTime = expirationTime;
  return user;
}

AuthTokens makeTokens(std::optional<double> expirationTime = std::nullopt) {
  AuthTokens tokens;
  tokens.accessToken = "access";
  tokens.expirationTime = expirationTime;
  return tokens;
}

ProviderFailure failure(AuthErrorCode code, std::optional<std::string> detail = std::nullopt) {
  return ProviderFailure(code, std::move(detail));
}

struct Rejection {
  AuthErrorCode code;
  std::string message;
};

template <typename T>
Rejection rejection(const std::shared_ptr<Promise<T>>& promise) {
  assert(promise->isRejected());
  try {
    std::rethrow_exception(promise->getError());
  } catch (const AuthException& error) {
    return Rejection{error.code(), error.what()};
  } catch (...) {
    assert(false && "native rejection must be an AuthException");
  }
  return Rejection{AuthErrorCode::UNKNOWN, ""};
}

template <typename T>
AuthErrorCode rejectionCode(const std::shared_ptr<Promise<T>>& promise) {
  return rejection(promise).code;
}

template <typename T>
std::string rejectionMessage(const std::shared_ptr<Promise<T>>& promise) {
  return rejection(promise).message;
}

void assertEveryAsyncCallRejectsWith(AuthErrorCode code) {
  assert(rejectionCode(PlatformAuth::createNonce()) == code);
  assert(rejectionCode(PlatformAuth::login(AuthProvider::GOOGLE)) == code);
  assert(rejectionCode(PlatformAuth::requestScopes({"email"})) == code);
  assert(rejectionCode(PlatformAuth::refreshToken()) == code);
  assert(rejectionCode(PlatformAuth::silentRestore()) == code);
  assert(rejectionCode(PlatformAuth::revokeAccess(AuthProvider::GOOGLE)) == code);
}

void testRegistryFailureRejectsAsyncCallsAndIsRetried() {
  registryMode = RegistryMode::THROWS;
  const int before = registryCalls;
  assertEveryAsyncCallRejectsWith(AuthErrorCode::CONFIGURATION_ERROR);
  assert(registryCalls == before + 6);

  bool threw = false;
  try { PlatformAuth::hasPlayServices(); } catch (const std::exception&) { threw = true; }
  assert(threw);

  for (auto mode : {RegistryMode::RETURNS_NULL, RegistryMode::RETURNS_WRONG_TYPE}) {
    registryMode = mode;
    assertEveryAsyncCallRejectsWith(AuthErrorCode::CONFIGURATION_ERROR);
    for (const auto& call : std::vector<std::function<void()>>{
           [] { PlatformAuth::hasPlayServices(); },
           [] { PlatformAuth::invalidatePendingOperations(); },
           [] { PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED); },
           [] { PlatformAuth::logout(); },
         }) {
      bool rejectedWithConfiguration = false;
      try { call(); }
      catch (const AuthException& error) { rejectedWithConfiguration = error.code() == AuthErrorCode::CONFIGURATION_ERROR; }
      assert(rejectedWithConfiguration);
    }
  }
}

void testConcurrentFirstUseCreatesTheAdapterOnce() {
  registryMode = RegistryMode::RETURNS_ADAPTER;
  const int before = registryCalls;
  std::atomic<bool> go{false};
  std::atomic<int> trueResults{0};
  std::vector<std::thread> threads;
  for (int index = 0; index < 8; ++index) {
    threads.emplace_back([&] {
      while (!go.load()) std::this_thread::yield();
      for (int call = 0; call < 50; ++call) {
        if (PlatformAuth::hasPlayServices()) trueResults++;
      }
    });
  }
  go = true;
  for (auto& thread : threads) thread.join();
  assert(registryCalls == before + 1);
  assert(trueResults == 400);

  registryMode = RegistryMode::THROWS;
  fakeAdapter->playServices = false;
  assert(!PlatformAuth::hasPlayServices());
  assert(registryCalls == before + 1);
}

void testCreateNonceBoundary() {
  fakeAdapter->reset();
  fakeAdapter->nonce = AuthNonce("raw-value", std::string(64, 'f'));
  auto nonce = PlatformAuth::createNonce();
  assert(nonce->isResolved());
  assert(nonce->getResult().raw == "raw-value");
  assert(nonce->getResult().hashed == std::string(64, 'f'));

  for (auto kind : {ThrowKind::RUNTIME, ThrowKind::NON_STD}) {
    fakeAdapter->throwKind = kind;
    auto failed = PlatformAuth::createNonce();
    assert(rejectionCode(failed) == AuthErrorCode::CONFIGURATION_ERROR);
    assert(rejectionMessage(failed) == "configuration_error");
  }

  fakeAdapter->throwKind = ThrowKind::AUTH;
  for (auto code : kAllCodes) {
    fakeAdapter->thrownCode = code;
    auto typed = PlatformAuth::createNonce();
    assert(rejectionCode(typed) == code);
    assert(rejectionMessage(typed) == "adapter detail");
  }
}

void testAdapterThrowingOnEveryAsyncMethod() {
  fakeAdapter->reset();
  fakeAdapter->throwKind = ThrowKind::AUTH;
  for (auto code : kAllCodes) {
    fakeAdapter->thrownCode = code;
    assert(rejectionCode(PlatformAuth::login(AuthProvider::GOOGLE)) == code);
    assert(rejectionCode(PlatformAuth::requestScopes({})) == code);
    assert(rejectionCode(PlatformAuth::refreshToken()) == code);
    assert(rejectionCode(PlatformAuth::silentRestore()) == code);
    assert(rejectionCode(PlatformAuth::revokeAccess(AuthProvider::MICROSOFT)) == code);
  }
  for (auto kind : {ThrowKind::RUNTIME, ThrowKind::NON_STD}) {
    fakeAdapter->throwKind = kind;
    assert(rejectionCode(PlatformAuth::login(AuthProvider::APPLE)) == AuthErrorCode::CONFIGURATION_ERROR);
    assert(rejectionCode(PlatformAuth::requestScopes({})) == AuthErrorCode::CONFIGURATION_ERROR);
    assert(rejectionCode(PlatformAuth::refreshToken()) == AuthErrorCode::CONFIGURATION_ERROR);
    assert(rejectionCode(PlatformAuth::silentRestore()) == AuthErrorCode::CONFIGURATION_ERROR);
    assert(rejectionCode(PlatformAuth::revokeAccess(AuthProvider::APPLE)) == AuthErrorCode::CONFIGURATION_ERROR);
    assert(rejectionMessage(PlatformAuth::login(AuthProvider::APPLE)) == "configuration_error");
  }
}

void testSyncMethodsDelegateAndPropagateAdapterErrors() {
  fakeAdapter->reset();
  PlatformAuth::invalidatePendingOperations();
  PlatformAuth::cancelPendingOperations(AuthErrorCode::NOT_SIGNED_IN);
  PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED);
  PlatformAuth::logout();
  assert(fakeAdapter->invalidateCalls == 1);
  assert(fakeAdapter->cancelCalls == 2);
  assert(fakeAdapter->logoutCalls == 1);

  fakeAdapter->throwOnSyncMethods = true;
  fakeAdapter->throwKind = ThrowKind::RUNTIME;
  for (const auto& call : std::vector<std::function<void()>>{
         [] { PlatformAuth::hasPlayServices(); },
         [] { PlatformAuth::invalidatePendingOperations(); },
         [] { PlatformAuth::cancelPendingOperations(AuthErrorCode::CANCELLED); },
         [] { PlatformAuth::logout(); },
       }) {
    bool propagated = false;
    try { call(); } catch (const std::runtime_error& error) { propagated = std::string(error.what()) == "adapter exploded"; }
    assert(propagated);
  }
}

void testEveryProviderFailureCodeReachesTheJsEnvelope() {
  fakeAdapter->reset();
  for (auto code : kAllCodes) {
    const std::string name = authErrorCodeName(code);
    for (const std::optional<std::string>& detail : {std::optional<std::string>{}, std::optional<std::string>{""}, std::optional<std::string>{"provider said no"}}) {
      const std::string expected = detail && !detail->empty() ? name + ": " + *detail : name;

      auto login = PlatformAuth::login(AuthProvider::GOOGLE);
      fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, failure(code, detail)));
      assert(rejectionCode(login) == code);
      assert(rejectionMessage(login) == expected);

      auto scopes = PlatformAuth::requestScopes({"email"});
      fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, failure(code, detail)));
      assert(rejectionCode(scopes) == code);
      assert(rejectionMessage(scopes) == expected);

      auto refresh = PlatformAuth::refreshToken();
      fakeAdapter->lastTokens->resolve(ProviderTokenResult(std::nullopt, failure(code, detail)));
      assert(rejectionCode(refresh) == code);
      assert(rejectionMessage(refresh) == expected);

      auto revoke = PlatformAuth::revokeAccess(AuthProvider::GOOGLE);
      fakeAdapter->lastVoid->resolve(ProviderVoidResult(failure(code, detail)));
      assert(rejectionCode(revoke) == code);
      assert(rejectionMessage(revoke) == expected);

      auto restore = PlatformAuth::silentRestore();
      fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, failure(code, detail)));
      if (code == AuthErrorCode::NOT_SIGNED_IN) {
        assert(restore->isResolved());
        assert(!restore->getResult().has_value());
      } else {
        assert(rejectionCode(restore) == code);
        assert(rejectionMessage(restore) == expected);
      }
    }
  }
}

void testOutOfRangeFailureCodeUsesUnknownEnvelope() {
  fakeAdapter->reset();
  auto login = PlatformAuth::login(AuthProvider::GOOGLE);
  fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, failure(static_cast<AuthErrorCode>(99), "detail")));
  assert(rejectionMessage(login) == "unknown: detail");
  auto negative = PlatformAuth::refreshToken();
  fakeAdapter->lastTokens->resolve(ProviderTokenResult(std::nullopt, failure(static_cast<AuthErrorCode>(-1))));
  assert(rejectionMessage(negative) == "unknown");
}

void testHostileDetailBytesPassThroughUnchanged() {
  fakeAdapter->reset();
  const std::string withNul("bad\0byte", 8);
  const std::string invalidUtf8("\xc3\x28\xff\xfe", 4);
  const std::string huge(1 << 20, 'x');
  for (const auto& detail : {invalidUtf8, huge}) {
    auto login = PlatformAuth::login(AuthProvider::GOOGLE);
    fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, failure(AuthErrorCode::NETWORK_ERROR, detail)));
    assert(rejectionCode(login) == AuthErrorCode::NETWORK_ERROR);
    assert(rejectionMessage(login) == std::string("network_error: ") + detail);
  }
  auto truncated = PlatformAuth::login(AuthProvider::GOOGLE);
  fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, failure(AuthErrorCode::NETWORK_ERROR, withNul)));
  assert(rejectionCode(truncated) == AuthErrorCode::NETWORK_ERROR);
  assert(rejectionMessage(truncated) == "network_error: bad");
}

void testUntypedAdapterPromiseRejectionMapsToUnknownWithoutLeakingDetail() {
  fakeAdapter->reset();
  for (const auto& error : {std::make_exception_ptr(std::runtime_error("secret token in message")),
                            std::make_exception_ptr(std::logic_error("cancelled: looks typed but is not")),
                            std::make_exception_ptr(42)}) {
    auto login = PlatformAuth::login(AuthProvider::GOOGLE);
    fakeAdapter->lastUser->reject(error);
    assert(rejectionCode(login) == AuthErrorCode::UNKNOWN);
    assert(rejectionMessage(login) == "unknown");

    auto scopes = PlatformAuth::requestScopes({"email"});
    fakeAdapter->lastUser->reject(error);
    assert(rejectionCode(scopes) == AuthErrorCode::UNKNOWN);

    auto restore = PlatformAuth::silentRestore();
    fakeAdapter->lastUser->reject(error);
    assert(rejectionCode(restore) == AuthErrorCode::UNKNOWN);

    auto refresh = PlatformAuth::refreshToken();
    fakeAdapter->lastTokens->reject(error);
    assert(rejectionCode(refresh) == AuthErrorCode::UNKNOWN);

    auto revoke = PlatformAuth::revokeAccess(AuthProvider::GOOGLE);
    fakeAdapter->lastVoid->reject(error);
    assert(rejectionCode(revoke) == AuthErrorCode::UNKNOWN);
    assert(rejectionMessage(revoke) == "unknown");
  }
}

void testTypedAdapterPromiseRejectionKeepsItsCodeAndDetail() {
  fakeAdapter->reset();
  for (auto code : kAllCodes) {
    const std::string name = authErrorCodeName(code);
    for (const std::optional<std::string>& detail : {std::optional<std::string>{}, std::optional<std::string>{"provider said no"}}) {
      const auto error = makeAuthError(code, detail);
      const std::string expected = detail ? name + ": " + *detail : name;

      auto login = PlatformAuth::login(AuthProvider::GOOGLE);
      fakeAdapter->lastUser->reject(error);
      assert(rejectionCode(login) == code);
      assert(rejectionMessage(login) == expected);

      auto scopes = PlatformAuth::requestScopes({"email"});
      fakeAdapter->lastUser->reject(error);
      assert(rejectionCode(scopes) == code);
      assert(rejectionMessage(scopes) == expected);

      auto restore = PlatformAuth::silentRestore();
      fakeAdapter->lastUser->reject(error);
      assert(rejectionCode(restore) == code);
      assert(rejectionMessage(restore) == expected);

      auto refresh = PlatformAuth::refreshToken();
      fakeAdapter->lastTokens->reject(error);
      assert(rejectionCode(refresh) == code);
      assert(rejectionMessage(refresh) == expected);

      auto revoke = PlatformAuth::revokeAccess(AuthProvider::GOOGLE);
      fakeAdapter->lastVoid->reject(error);
      assert(rejectionCode(revoke) == code);
      assert(rejectionMessage(revoke) == expected);
    }
  }
}

void testContradictoryOrEmptyProviderResults() {
  fakeAdapter->reset();
  auto both = PlatformAuth::login(AuthProvider::GOOGLE);
  fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(), failure(AuthErrorCode::CANCELLED)));
  assert(rejectionCode(both) == AuthErrorCode::PARSE_ERROR);

  auto neither = PlatformAuth::login(AuthProvider::GOOGLE);
  fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, std::nullopt));
  assert(rejectionCode(neither) == AuthErrorCode::PARSE_ERROR);

  auto scopesNeither = PlatformAuth::requestScopes({});
  fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, std::nullopt));
  assert(rejectionCode(scopesNeither) == AuthErrorCode::PARSE_ERROR);

  auto tokensBoth = PlatformAuth::refreshToken();
  fakeAdapter->lastTokens->resolve(ProviderTokenResult(makeTokens(), failure(AuthErrorCode::NETWORK_ERROR)));
  assert(rejectionCode(tokensBoth) == AuthErrorCode::PARSE_ERROR);

  auto tokensNeither = PlatformAuth::refreshToken();
  fakeAdapter->lastTokens->resolve(ProviderTokenResult(std::nullopt, std::nullopt));
  assert(rejectionCode(tokensNeither) == AuthErrorCode::PARSE_ERROR);

  auto restoreBoth = PlatformAuth::silentRestore();
  fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(), failure(AuthErrorCode::NOT_SIGNED_IN)));
  assert(rejectionCode(restoreBoth) == AuthErrorCode::PARSE_ERROR);

  auto restoreNeither = PlatformAuth::silentRestore();
  fakeAdapter->lastUser->resolve(ProviderUserResult(std::nullopt, std::nullopt));
  assert(restoreNeither->isResolved() && !restoreNeither->getResult().has_value());

  auto revoke = PlatformAuth::revokeAccess(AuthProvider::APPLE);
  assert(fakeAdapter->lastProvider == AuthProvider::APPLE);
  fakeAdapter->lastVoid->resolve(ProviderVoidResult(std::nullopt));
  assert(revoke->isResolved());
}

void testExpirationCastGuardsOnEveryUserAndTokenPath() {
  fakeAdapter->reset();
  const double invalid[] = {
    std::numeric_limits<double>::quiet_NaN(),
    std::numeric_limits<double>::infinity(),
    -std::numeric_limits<double>::infinity(),
    -1.0,
    -0.5,
    -std::numeric_limits<double>::denorm_min(),
    std::numeric_limits<double>::lowest(),
  };
  for (double expiration : invalid) {
    auto login = PlatformAuth::login(AuthProvider::GOOGLE);
    fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(expiration), std::nullopt));
    assert(rejectionCode(login) == AuthErrorCode::PARSE_ERROR);

    auto scopes = PlatformAuth::requestScopes({});
    fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(expiration), std::nullopt));
    assert(rejectionCode(scopes) == AuthErrorCode::PARSE_ERROR);

    auto restore = PlatformAuth::silentRestore();
    fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(expiration), std::nullopt));
    assert(rejectionCode(restore) == AuthErrorCode::PARSE_ERROR);

    auto refresh = PlatformAuth::refreshToken();
    fakeAdapter->lastTokens->resolve(ProviderTokenResult(makeTokens(expiration), std::nullopt));
    assert(rejectionCode(refresh) == AuthErrorCode::PARSE_ERROR);
  }

  const double valid[] = {0.0, -0.0, 0.5, 1789500000123.456, std::numeric_limits<double>::max()};
  for (double expiration : valid) {
    auto login = PlatformAuth::login(AuthProvider::GOOGLE);
    fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(expiration), std::nullopt));
    assert(login->isResolved());
    assert(login->getResult().expirationTime == expiration);

    auto refresh = PlatformAuth::refreshToken();
    fakeAdapter->lastTokens->resolve(ProviderTokenResult(makeTokens(expiration), std::nullopt));
    assert(refresh->isResolved());
    assert(refresh->getResult().expirationTime == expiration);

    auto restore = PlatformAuth::silentRestore();
    fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(expiration), std::nullopt));
    assert(restore->isResolved() && restore->getResult()->expirationTime == expiration);
  }
}

void testArgumentsAndSynchronousSettlementPassThrough() {
  fakeAdapter->reset();
  LoginOptions options;
  options.scopes = std::vector<std::string>{"openid", std::string(4096, 's')};
  options.nonce = std::string(64, 'b');
  options.loginHint = std::string("hint\0with-nul", 13);
  auto login = PlatformAuth::login(AuthProvider::MICROSOFT, options);
  assert(fakeAdapter->lastProvider == AuthProvider::MICROSOFT);
  assert(fakeAdapter->lastOptions->scopes == options.scopes);
  assert(fakeAdapter->lastOptions->nonce == options.nonce);
  assert(fakeAdapter->lastOptions->loginHint == options.loginHint);
  fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(), std::nullopt));
  assert(login->isResolved());

  auto scopes = PlatformAuth::requestScopes({"a", "", "a"});
  assert((fakeAdapter->lastScopes == std::vector<std::string>{"a", "", "a"}));
  fakeAdapter->lastUser->resolve(ProviderUserResult(makeUser(), std::nullopt));
  assert(scopes->isResolved());

  fakeAdapter->settle = Settle::IMMEDIATE;
  fakeAdapter->immediateUser = ProviderUserResult(std::nullopt, failure(AuthErrorCode::CANCELLED, "sync"));
  auto immediateFailure = PlatformAuth::login(AuthProvider::GOOGLE);
  assert(rejectionMessage(immediateFailure) == "cancelled: sync");
  fakeAdapter->immediateUser = ProviderUserResult(makeUser(1.0), std::nullopt);
  auto immediateSuccess = PlatformAuth::silentRestore();
  assert(immediateSuccess->isResolved() && immediateSuccess->getResult()->expirationTime == 1.0);
}

} // namespace

std::shared_ptr<HybridObject> HybridObjectRegistry::createHybridObject(const std::string& hybridObjectName) {
  registryCalls++;
  assert(hybridObjectName == "NativeAuthAdapter");
  switch (registryMode) {
    case RegistryMode::THROWS: throw std::runtime_error("NativeAuthAdapter is not registered");
    case RegistryMode::RETURNS_NULL: return nullptr;
    case RegistryMode::RETURNS_WRONG_TYPE: return std::make_shared<UnrelatedObject>();
    case RegistryMode::RETURNS_ADAPTER: return fakeAdapter;
  }
  return nullptr;
}

int main() {
  testRegistryFailureRejectsAsyncCallsAndIsRetried();
  testConcurrentFirstUseCreatesTheAdapterOnce();
  testCreateNonceBoundary();
  testAdapterThrowingOnEveryAsyncMethod();
  testSyncMethodsDelegateAndPropagateAdapterErrors();
  testEveryProviderFailureCodeReachesTheJsEnvelope();
  testOutOfRangeFailureCodeUsesUnknownEnvelope();
  testHostileDetailBytesPassThroughUnchanged();
  testUntypedAdapterPromiseRejectionMapsToUnknownWithoutLeakingDetail();
  testTypedAdapterPromiseRejectionKeepsItsCodeAndDetail();
  testContradictoryOrEmptyProviderResults();
  testExpirationCastGuardsOnEveryUserAndTokenPath();
  testArgumentsAndSynchronousSettlementPassThrough();
  std::cout << "PlatformAuth tests passed!" << std::endl;
  return 0;
}

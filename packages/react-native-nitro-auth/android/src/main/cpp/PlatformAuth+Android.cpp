#include "PlatformAuth.hpp"
#include "AuthError.hpp"
#include "AuthUser.hpp"
#include "AuthTokens.hpp"
#include "AuthCache.hpp"
#include "MicrosoftPrompt.hpp"
#include <fbjni/fbjni.h>
#include <NitroModules/NitroLogger.hpp>
#include <NitroModules/Promise.hpp>
#include <cstdint>
#include <exception>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <vector>

namespace margelo::nitro::NitroAuth {

using namespace facebook::jni;

static std::shared_ptr<Promise<AuthUser>> gLoginPromise;
static std::shared_ptr<Promise<AuthUser>> gScopesPromise;
static std::shared_ptr<Promise<AuthTokens>> gRefreshPromise;
static std::shared_ptr<Promise<std::optional<AuthUser>>> gSilentPromise;
static std::shared_ptr<Promise<void>> gRevokeAccessPromise;
static std::mutex gMutex;
static uint64_t gGenerationCounter = 0;
static uint64_t gLoginGeneration = 0;
static uint64_t gScopesGeneration = 0;
static uint64_t gRefreshGeneration = 0;
static uint64_t gSilentGeneration = 0;
static uint64_t gRevokeAccessGeneration = 0;
static std::mutex gJniMutex;
static jclass gAuthAdapterClass = nullptr;
static jmethodID gLoginMethod = nullptr;
static jmethodID gRequestScopesMethod = nullptr;
static jmethodID gRefreshMethod = nullptr;
static jmethodID gRestoreMethod = nullptr;
static jmethodID gHasPlayMethod = nullptr;
static jmethodID gCancelPendingOperationsMethod = nullptr;
static jmethodID gLogoutMethod = nullptr;
static jmethodID gRevokeAccessMethod = nullptr;

static uint64_t nextGenerationLocked() {
    ++gGenerationCounter;
    if (gGenerationCounter == 0) {
        ++gGenerationCounter;
    }
    return gGenerationCounter;
}

struct AuthAdapterMethods {
    JNIEnv* env;
    jclass clazz;
    jmethodID login;
    jmethodID requestScopes;
    jmethodID refresh;
    jmethodID restore;
    jmethodID hasPlay;
    jmethodID cancelPendingOperations;
    jmethodID logout;
    jmethodID revokeAccess;

    AuthAdapterMethods(
        JNIEnv* env,
        jclass clazz,
        jmethodID login,
        jmethodID requestScopes,
        jmethodID refresh,
        jmethodID restore,
        jmethodID hasPlay,
        jmethodID cancelPendingOperations,
        jmethodID logout,
        jmethodID revokeAccess)
        : env(env),
          clazz(clazz),
          login(login),
          requestScopes(requestScopes),
          refresh(refresh),
          restore(restore),
          hasPlay(hasPlay),
          cancelPendingOperations(cancelPendingOperations),
          logout(logout),
          revokeAccess(revokeAccess) {}

    ~AuthAdapterMethods() {
        if (clazz != nullptr) {
            env->DeleteLocalRef(clazz);
        }
    }

    AuthAdapterMethods(const AuthAdapterMethods&) = delete;
    AuthAdapterMethods& operator=(const AuthAdapterMethods&) = delete;

    AuthAdapterMethods(AuthAdapterMethods&& other) noexcept
        : env(other.env),
          clazz(other.clazz),
          login(other.login),
          requestScopes(other.requestScopes),
          refresh(other.refresh),
          restore(other.restore),
          hasPlay(other.hasPlay),
          cancelPendingOperations(other.cancelPendingOperations),
          logout(other.logout),
          revokeAccess(other.revokeAccess) {
        other.clazz = nullptr;
    }
};

static void clearCachedJniRefsLocked(JNIEnv* env) {
    if (gAuthAdapterClass != nullptr) {
        env->DeleteGlobalRef(gAuthAdapterClass);
        gAuthAdapterClass = nullptr;
    }
    gLoginMethod = nullptr;
    gRequestScopesMethod = nullptr;
    gRefreshMethod = nullptr;
    gRestoreMethod = nullptr;
    gHasPlayMethod = nullptr;
    gCancelPendingOperationsMethod = nullptr;
    gLogoutMethod = nullptr;
    gRevokeAccessMethod = nullptr;
}

static void ensureAuthAdapterMethodsLocked(JNIEnv* env) {
    if (gAuthAdapterClass != nullptr && gLoginMethod != nullptr
        && gRequestScopesMethod != nullptr && gRefreshMethod != nullptr
        && gRestoreMethod != nullptr && gHasPlayMethod != nullptr
        && gCancelPendingOperationsMethod != nullptr
        && gLogoutMethod != nullptr && gRevokeAccessMethod != nullptr) {
        return;
    }

    if (gAuthAdapterClass == nullptr) {
        jclass localAdapterClass = env->FindClass("com/auth/AuthAdapter");
        if (localAdapterClass == nullptr) {
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
            }
            throw std::runtime_error("Unable to resolve com/auth/AuthAdapter");
        }
        gAuthAdapterClass = static_cast<jclass>(env->NewGlobalRef(localAdapterClass));
        env->DeleteLocalRef(localAdapterClass);
        if (gAuthAdapterClass == nullptr) {
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
            }
            throw std::runtime_error("Unable to cache AuthAdapter class");
        }
    }

    if (gLoginMethod == nullptr) {
        gLoginMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "loginSync",
            "(Landroid/content/Context;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;ZZZZZZLjava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;J)V"
        );
    }
    if (gRequestScopesMethod == nullptr) {
        gRequestScopesMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "requestScopesSync",
            "(Landroid/content/Context;[Ljava/lang/String;J)V"
        );
    }
    if (gRefreshMethod == nullptr) {
        gRefreshMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "refreshTokenSync",
            "(Landroid/content/Context;J)V"
        );
    }
    if (gRestoreMethod == nullptr) {
        gRestoreMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "restoreSession",
            "(Landroid/content/Context;J)V"
        );
    }
    if (gHasPlayMethod == nullptr) {
        gHasPlayMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "hasPlayServices",
            "(Landroid/content/Context;)Z"
        );
    }
    if (gCancelPendingOperationsMethod == nullptr) {
        gCancelPendingOperationsMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "cancelPendingOperations",
            "()V"
        );
    }
    if (gLogoutMethod == nullptr) {
        gLogoutMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "logoutSync",
            "(Landroid/content/Context;)V"
        );
    }
    if (gRevokeAccessMethod == nullptr) {
        gRevokeAccessMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "revokeAccessSync",
            "(Landroid/content/Context;Ljava/lang/String;J)V"
        );
    }

    if (gLoginMethod == nullptr || gRequestScopesMethod == nullptr
        || gRefreshMethod == nullptr || gRestoreMethod == nullptr
        || gHasPlayMethod == nullptr || gCancelPendingOperationsMethod == nullptr
        || gLogoutMethod == nullptr
        || gRevokeAccessMethod == nullptr) {
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
        clearCachedJniRefsLocked(env);
        throw std::runtime_error("Unable to resolve AuthAdapter methods");
    }
}

static AuthAdapterMethods getAuthAdapterMethods(JNIEnv* env) {
    std::lock_guard<std::mutex> lock(gJniMutex);
    ensureAuthAdapterMethodsLocked(env);
    auto localClass = static_cast<jclass>(env->NewLocalRef(gAuthAdapterClass));
    if (localClass == nullptr) {
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
        throw std::runtime_error("Unable to snapshot AuthAdapter class");
    }
    return AuthAdapterMethods(
        env,
        localClass,
        gLoginMethod,
        gRequestScopesMethod,
        gRefreshMethod,
        gRestoreMethod,
        gHasPlayMethod,
        gCancelPendingOperationsMethod,
        gLogoutMethod,
        gRevokeAccessMethod);
}

static void clearCachedJniRefs(JNIEnv* env) {
    std::lock_guard<std::mutex> lock(gJniMutex);
    clearCachedJniRefsLocked(env);
}

static void invokeCancelPendingOperations(JNIEnv* env) {
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        return;
    }

    env->CallStaticVoidMethod(methods->clazz, methods->cancelPendingOperations);
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }
}

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
    auto promise = Promise<AuthUser>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR));
        return promise;
    }

    uint64_t generation;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gLoginPromise) {
            promise->reject(makeAuthError(AuthErrorCode::OPERATION_IN_PROGRESS));
            return promise;
        }
        generation = nextGenerationLocked();
        gLoginGeneration = generation;
        gLoginPromise = promise;
    }
    
    std::string providerStr;
    switch (provider) {
        case AuthProvider::GOOGLE: providerStr = "google"; break;
        case AuthProvider::APPLE: providerStr = "apple"; break;
        case AuthProvider::MICROSOFT: providerStr = "microsoft"; break;
    }
    
    std::vector<std::string> scopes = {"email", "profile"};
    std::optional<std::string> loginHint;
    std::optional<std::string> nonce;
    std::optional<std::string> tenant;
    std::optional<std::string> prompt;
    std::optional<std::string> hostedDomain;
    std::optional<std::string> openIDRealm;
    bool useOneTap = false;
    bool forceAccountPicker = false;
    bool useLegacyGoogleSignIn = false;
    bool filterByAuthorizedAccounts = false;
    bool forceCodeForRefreshToken = false;
    bool requestVerifiedPhoneNumber = false;

    if (options) {
        if (options->scopes) scopes = *options->scopes;
        loginHint = options->loginHint;
        nonce = options->nonce;
        tenant = options->tenant;
        hostedDomain = options->hostedDomain;
        openIDRealm = options->openIDRealm;
        if (options->prompt.has_value()) {
            switch (options->prompt.value()) {
                case MicrosoftPrompt::LOGIN: prompt = "login"; break;
                case MicrosoftPrompt::CONSENT: prompt = "consent"; break;
                case MicrosoftPrompt::SELECT_ACCOUNT: prompt = "select_account"; break;
                case MicrosoftPrompt::NONE: prompt = "none"; break;
            }
        }
        useOneTap = options->useOneTap.value_or(false);
        forceAccountPicker = options->forceAccountPicker.value_or(false);
        useLegacyGoogleSignIn = options->useLegacyGoogleSignIn.value_or(false);
        filterByAuthorizedAccounts = options->filterByAuthorizedAccounts.value_or(false);
        forceCodeForRefreshToken = options->forceCodeForRefreshToken.value_or(false);
        requestVerifiedPhoneNumber = options->requestVerifiedPhoneNumber.value_or(false);
    }

    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gLoginGeneration == generation) gLoginPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }
    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray jScopes = env->NewObjectArray(scopes.size(), stringClass, nullptr);
    for (size_t i = 0; i < scopes.size(); i++) {
        auto jstr = make_jstring(scopes[i]);
        env->SetObjectArrayElement(jScopes, i, jstr.get());
    }

    local_ref<JString> providerRef = make_jstring(providerStr);
    local_ref<JString> loginHintRef;
    local_ref<JString> nonceRef;
    local_ref<JString> tenantRef;
    local_ref<JString> promptRef;
    local_ref<JString> hostedDomainRef;
    local_ref<JString> openIDRealmRef;

    if (loginHint.has_value()) {
        loginHintRef = make_jstring(loginHint.value());
    }
    if (nonce.has_value()) {
        nonceRef = make_jstring(nonce.value());
    }
    if (tenant.has_value()) {
        tenantRef = make_jstring(tenant.value());
    }
    if (prompt.has_value()) {
        promptRef = make_jstring(prompt.value());
    }
    if (hostedDomain.has_value()) {
        hostedDomainRef = make_jstring(hostedDomain.value());
    }
    if (openIDRealm.has_value()) {
        openIDRealmRef = make_jstring(openIDRealm.value());
    }

    env->CallStaticVoidMethod(methods->clazz, methods->login,
        contextPtr,
        providerRef.get(),
        jScopes,
        loginHintRef.get(),
        nonceRef.get(),
        (jboolean)useOneTap,
        (jboolean)forceAccountPicker,
        (jboolean)useLegacyGoogleSignIn,
        (jboolean)filterByAuthorizedAccounts,
        (jboolean)forceCodeForRefreshToken,
        (jboolean)requestVerifiedPhoneNumber,
        tenantRef.get(),
        promptRef.get(),
        hostedDomainRef.get(),
        openIDRealmRef.get(),
        static_cast<jlong>(generation));

    env->DeleteLocalRef(jScopes);
    env->DeleteLocalRef(stringClass);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gLoginGeneration == generation) gLoginPromise = nullptr;
        }
        promise->reject(std::make_exception_ptr(std::runtime_error("JNI call failed")));
        return promise;
    }

    return promise;
}

std::shared_ptr<Promise<AuthUser>> PlatformAuth::requestScopes(const std::vector<std::string>& scopes) {
    auto promise = Promise<AuthUser>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR));
        return promise;
    }
    
    uint64_t generation;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gScopesPromise) {
            promise->reject(makeAuthError(AuthErrorCode::OPERATION_IN_PROGRESS));
            return promise;
        }
        generation = nextGenerationLocked();
        gScopesGeneration = generation;
        gScopesPromise = promise;
    }
    
    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gScopesGeneration == generation) gScopesPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }
    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray jScopes = env->NewObjectArray(scopes.size(), stringClass, nullptr);
    for (size_t i = 0; i < scopes.size(); i++) {
        auto jstr = make_jstring(scopes[i]);
        env->SetObjectArrayElement(jScopes, i, jstr.get());
    }

    env->CallStaticVoidMethod(
        methods->clazz,
        methods->requestScopes,
        contextPtr,
        jScopes,
        static_cast<jlong>(generation));
    env->DeleteLocalRef(jScopes);
    env->DeleteLocalRef(stringClass);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gScopesGeneration == generation) gScopesPromise = nullptr;
        }
        promise->reject(std::make_exception_ptr(std::runtime_error("JNI call failed")));
        return promise;
    }

    return promise;
}

std::shared_ptr<Promise<AuthTokens>> PlatformAuth::refreshToken() {
    auto promise = Promise<AuthTokens>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR));
        return promise;
    }
    
    uint64_t generation;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gRefreshPromise) {
            promise->reject(makeAuthError(AuthErrorCode::OPERATION_IN_PROGRESS));
            return promise;
        }
        generation = nextGenerationLocked();
        gRefreshGeneration = generation;
        gRefreshPromise = promise;
    }
    
    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gRefreshGeneration == generation) gRefreshPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }

    env->CallStaticVoidMethod(
        methods->clazz,
        methods->refresh,
        contextPtr,
        static_cast<jlong>(generation));

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gRefreshGeneration == generation) gRefreshPromise = nullptr;
        }
        promise->reject(std::make_exception_ptr(std::runtime_error("JNI call failed")));
        return promise;
    }

    return promise;
}

std::shared_ptr<Promise<std::optional<AuthUser>>> PlatformAuth::silentRestore() {
    auto promise = Promise<std::optional<AuthUser>>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR));
        return promise;
    }

    uint64_t generation;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gSilentPromise) {
            promise->reject(makeAuthError(AuthErrorCode::OPERATION_IN_PROGRESS));
            return promise;
        }
        generation = nextGenerationLocked();
        gSilentGeneration = generation;
        gSilentPromise = promise;
    }

    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gSilentGeneration == generation) gSilentPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }

    env->CallStaticVoidMethod(
        methods->clazz,
        methods->restore,
        contextPtr,
        static_cast<jlong>(generation));

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gSilentGeneration == generation) gSilentPromise = nullptr;
        }
        promise->reject(std::make_exception_ptr(std::runtime_error("JNI call failed")));
        return promise;
    }

    return promise;
}

bool PlatformAuth::hasPlayServices() {
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) return false;

    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        return false;
    }

    jboolean result = env->CallStaticBooleanMethod(methods->clazz, methods->hasPlay, contextPtr);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        return false;
    }

    return result;
}

void PlatformAuth::invalidatePendingOperations() {
    invokeCancelPendingOperations(Environment::current());
}

void PlatformAuth::cancelPendingOperations(AuthErrorCode reason) {
    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    std::shared_ptr<Promise<void>> revokeAccessPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        loginPromise = std::move(gLoginPromise);
        scopesPromise = std::move(gScopesPromise);
        refreshPromise = std::move(gRefreshPromise);
        silentPromise = std::move(gSilentPromise);
        revokeAccessPromise = std::move(gRevokeAccessPromise);
        gLoginGeneration = nextGenerationLocked();
        gScopesGeneration = nextGenerationLocked();
        gRefreshGeneration = nextGenerationLocked();
        gSilentGeneration = nextGenerationLocked();
        gRevokeAccessGeneration = nextGenerationLocked();
    }

    auto cancellation = makeAuthError(reason);
    if (loginPromise) loginPromise->reject(cancellation);
    if (scopesPromise) scopesPromise->reject(cancellation);
    if (refreshPromise) refreshPromise->reject(cancellation);
    if (silentPromise) silentPromise->reject(cancellation);
    if (revokeAccessPromise) revokeAccessPromise->reject(cancellation);

    invokeCancelPendingOperations(Environment::current());
}

void PlatformAuth::logout() {
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) return;

    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        return;
    }

    env->CallStaticVoidMethod(methods->clazz, methods->logout, contextPtr);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }
}

std::shared_ptr<Promise<void>> PlatformAuth::revokeAccess(AuthProvider provider) {
    auto promise = Promise<void>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(makeAuthError(AuthErrorCode::CONFIGURATION_ERROR));
        return promise;
    }

    uint64_t generation;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gRevokeAccessPromise) {
            promise->reject(makeAuthError(AuthErrorCode::OPERATION_IN_PROGRESS));
            return promise;
        }
        generation = nextGenerationLocked();
        gRevokeAccessGeneration = generation;
        gRevokeAccessPromise = promise;
    }

    JNIEnv* env = Environment::current();
    std::optional<AuthAdapterMethods> methods;
    try {
        methods.emplace(getAuthAdapterMethods(env));
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gRevokeAccessGeneration == generation) gRevokeAccessPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }

    const char* providerName = provider == AuthProvider::GOOGLE
        ? "google"
        : provider == AuthProvider::APPLE ? "apple" : "microsoft";
    jstring providerString = env->NewStringUTF(providerName);
    env->CallStaticVoidMethod(
        methods->clazz,
        methods->revokeAccess,
        contextPtr,
        providerString,
        static_cast<jlong>(generation));
    env->DeleteLocalRef(providerString);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            if (gRevokeAccessGeneration == generation) gRevokeAccessPromise = nullptr;
        }
        promise->reject(std::make_exception_ptr(std::runtime_error("JNI call failed")));
        return promise;
    }

    return promise;
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeInitialize(JNIEnv*, jclass, jobject context) {
    AuthCache::setAndroidContext(context);
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_auth_AuthAdapter_nativeOnLoginSuccess(
    JNIEnv* env, jclass,
    jstring origin, jstring provider, jstring email, jstring name, jstring photo, jstring idToken, jstring accessToken, jstring serverAuthCode, jstring userId, jstring phoneNumber, jstring hostedDomain, jobjectArray scopes, jobject expirationTime, jlong generation) {

    const char* originCStr = env->GetStringUTFChars(origin, nullptr);
    std::string originStr(originCStr);
    env->ReleaseStringUTFChars(origin, originCStr);

    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (originStr == "login") {
            if (gLoginPromise && generation > 0 && gLoginGeneration == static_cast<uint64_t>(generation)) {
                loginPromise = std::move(gLoginPromise);
            }
        } else if (originStr == "scopes") {
            if (gScopesPromise && generation > 0 && gScopesGeneration == static_cast<uint64_t>(generation)) {
                scopesPromise = std::move(gScopesPromise);
            }
        } else if (originStr == "silent") {
            if (gSilentPromise && generation > 0 && gSilentGeneration == static_cast<uint64_t>(generation)) {
                silentPromise = std::move(gSilentPromise);
            }
        }
    }

    if (!loginPromise && !scopesPromise && !silentPromise) return JNI_FALSE;

    AuthUser user;
    const char* providerCStr = env->GetStringUTFChars(provider, nullptr);
    std::string providerStr(providerCStr);
    env->ReleaseStringUTFChars(provider, providerCStr);
    if (providerStr == "google") {
        user.provider = AuthProvider::GOOGLE;
    } else if (providerStr == "microsoft") {
        user.provider = AuthProvider::MICROSOFT;
    } else {
        auto rejection = makeAuthError(AuthErrorCode::UNSUPPORTED_PROVIDER);
        if (loginPromise) loginPromise->reject(rejection);
        if (scopesPromise) scopesPromise->reject(rejection);
        if (silentPromise) silentPromise->reject(rejection);
        return JNI_TRUE;
    }
    
    if (email) {
        const char* s = env->GetStringUTFChars(email, nullptr);
        user.email = std::string(s);
        env->ReleaseStringUTFChars(email, s);
    }
    if (name) {
        const char* s = env->GetStringUTFChars(name, nullptr);
        user.name = std::string(s);
        env->ReleaseStringUTFChars(name, s);
    }
    if (photo) {
        const char* s = env->GetStringUTFChars(photo, nullptr);
        user.photo = std::string(s);
        env->ReleaseStringUTFChars(photo, s);
    }
    if (idToken) {
        const char* s = env->GetStringUTFChars(idToken, nullptr);
        user.idToken = std::string(s);
        env->ReleaseStringUTFChars(idToken, s);
    }
    if (accessToken) {
        const char* s = env->GetStringUTFChars(accessToken, nullptr);
        user.accessToken = std::string(s);
        env->ReleaseStringUTFChars(accessToken, s);
    }
    if (serverAuthCode) {
        const char* s = env->GetStringUTFChars(serverAuthCode, nullptr);
        user.serverAuthCode = std::string(s);
        env->ReleaseStringUTFChars(serverAuthCode, s);
    }
    if (userId) {
        const char* s = env->GetStringUTFChars(userId, nullptr);
        user.userId = std::string(s);
        env->ReleaseStringUTFChars(userId, s);
    }
    if (phoneNumber) {
        const char* s = env->GetStringUTFChars(phoneNumber, nullptr);
        user.phoneNumber = std::string(s);
        env->ReleaseStringUTFChars(phoneNumber, s);
    }
    if (hostedDomain) {
        const char* s = env->GetStringUTFChars(hostedDomain, nullptr);
        user.hostedDomain = std::string(s);
        env->ReleaseStringUTFChars(hostedDomain, s);
    }
    if (scopes) {
        int len = env->GetArrayLength(scopes);
        std::vector<std::string> scopeVec;
        for (int i = 0; i < len; i++) {
            jstring jstr = (jstring)env->GetObjectArrayElement(scopes, i);
            const char* s = env->GetStringUTFChars(jstr, nullptr);
            scopeVec.push_back(std::string(s));
            env->ReleaseStringUTFChars(jstr, s);
            env->DeleteLocalRef(jstr);
        }
        user.scopes = scopeVec;
    }
    if (expirationTime) {
        jclass longClass = env->FindClass("java/lang/Long");
        jmethodID longValueMethod = env->GetMethodID(longClass, "longValue", "()J");
        user.expirationTime = (double)env->CallLongMethod(expirationTime, longValueMethod);
        env->DeleteLocalRef(longClass);
    }
    
    if (loginPromise) loginPromise->resolve(user);
    if (scopesPromise) scopesPromise->resolve(user);
    if (silentPromise) silentPromise->resolve(user);
    return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_auth_AuthAdapter_nativeOnLoginError(
    JNIEnv* env, jclass, jstring origin, jint code, jstring underlyingError, jlong generation) {

    const char* originCStr = env->GetStringUTFChars(origin, nullptr);
    std::string originStr(originCStr);
    env->ReleaseStringUTFChars(origin, originCStr);

    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (originStr == "login") {
            if (gLoginPromise && generation > 0 && gLoginGeneration == static_cast<uint64_t>(generation)) {
                loginPromise = std::move(gLoginPromise);
            }
        } else if (originStr == "scopes") {
            if (gScopesPromise && generation > 0 && gScopesGeneration == static_cast<uint64_t>(generation)) {
                scopesPromise = std::move(gScopesPromise);
            }
        } else if (originStr == "silent") {
            if (gSilentPromise && generation > 0 && gSilentGeneration == static_cast<uint64_t>(generation)) {
                silentPromise = std::move(gSilentPromise);
            }
        }
    }

    if (!loginPromise && !scopesPromise && !silentPromise) return JNI_FALSE;

    const AuthErrorCode errorCode = authErrorCodeFromInt(static_cast<int>(code));
    std::optional<std::string> underlying;
    if (underlyingError) {
      const char* uCStr = env->GetStringUTFChars(underlyingError, nullptr);
      underlying = std::string(uCStr);
      env->ReleaseStringUTFChars(underlyingError, uCStr);
    }

    auto rejection = makeAuthError(errorCode, underlying);
    if (loginPromise) loginPromise->reject(rejection);
    if (scopesPromise) scopesPromise->reject(rejection);
    if (silentPromise) {
      if (errorCode == AuthErrorCode::NOT_SIGNED_IN) silentPromise->resolve(std::nullopt);
      else silentPromise->reject(rejection);
    }
    return JNI_TRUE;
  }

extern "C" JNIEXPORT jboolean JNICALL Java_com_auth_AuthAdapter_nativeOnRefreshSuccess(
    JNIEnv* env, jclass, jstring idToken, jstring accessToken, jobject expirationTime, jlong generation) {
    
    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gRefreshPromise && generation > 0 && gRefreshGeneration == static_cast<uint64_t>(generation)) {
            refreshPromise = std::move(gRefreshPromise);
        }
    }
    
    if (!refreshPromise) return JNI_FALSE;
    if (refreshPromise) {
        AuthTokens tokens;
        if (idToken) {
            const char* s = env->GetStringUTFChars(idToken, nullptr);
            tokens.idToken = std::string(s);
            env->ReleaseStringUTFChars(idToken, s);
        }
        if (accessToken) {
            const char* s = env->GetStringUTFChars(accessToken, nullptr);
            tokens.accessToken = std::string(s);
            env->ReleaseStringUTFChars(accessToken, s);
        }
        if (expirationTime) {
            jclass longClass = env->FindClass("java/lang/Long");
            jmethodID longValueMethod = env->GetMethodID(longClass, "longValue", "()J");
            tokens.expirationTime = (double)env->CallLongMethod(expirationTime, longValueMethod);
            env->DeleteLocalRef(longClass);
        }
        refreshPromise->resolve(tokens);
    }
    return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_auth_AuthAdapter_nativeOnRefreshError(
    JNIEnv* env, jclass, jint code, jstring underlyingError, jlong generation) {

    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gRefreshPromise && generation > 0 && gRefreshGeneration == static_cast<uint64_t>(generation)) {
            refreshPromise = std::move(gRefreshPromise);
        }
    }
    if (!refreshPromise) return JNI_FALSE;
    if (refreshPromise) {
        const AuthErrorCode errorCode = authErrorCodeFromInt(static_cast<int>(code));
        std::optional<std::string> underlying;
        if (underlyingError) {
            const char* uCStr = env->GetStringUTFChars(underlyingError, nullptr);
            underlying = std::string(uCStr);
            env->ReleaseStringUTFChars(underlyingError, uCStr);
        }
        refreshPromise->reject(makeAuthError(errorCode, underlying));
    }
    return JNI_TRUE;
  }

static std::optional<int> unboxOptionalInteger(JNIEnv* env, jobject value) {
    if (value == nullptr) {
        return std::nullopt;
    }
    jclass integerClass = env->FindClass("java/lang/Integer");
    if (integerClass == nullptr) {
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
        return std::nullopt;
    }
    jmethodID intValueMethod = env->GetMethodID(integerClass, "intValue", "()I");
    env->DeleteLocalRef(integerClass);
    if (intValueMethod == nullptr) {
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
        return std::nullopt;
    }
    return static_cast<int>(env->CallIntMethod(value, intValueMethod));
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_auth_AuthAdapter_nativeOnRevokeAccessResult(
    JNIEnv* env, jclass, jobject code, jstring underlyingError, jlong generation) {
    std::shared_ptr<Promise<void>> revokeAccessPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gRevokeAccessPromise && generation > 0 && gRevokeAccessGeneration == static_cast<uint64_t>(generation)) {
            revokeAccessPromise = std::move(gRevokeAccessPromise);
        }
    }
    if (!revokeAccessPromise) {
        return JNI_FALSE;
    }
    std::optional<int> errorCodeValue = unboxOptionalInteger(env, code);
    if (!errorCodeValue.has_value()) {
        revokeAccessPromise->resolve();
        return JNI_TRUE;
    }

    const AuthErrorCode errorCode = authErrorCodeFromInt(*errorCodeValue);
    std::optional<std::string> underlying;
    if (underlyingError) {
        const char* underlyingChars = env->GetStringUTFChars(underlyingError, nullptr);
        underlying = std::string(underlyingChars);
        env->ReleaseStringUTFChars(underlyingError, underlyingChars);
    }
    revokeAccessPromise->reject(makeAuthError(errorCode, underlying));
    return JNI_TRUE;
  }

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeDispose(JNIEnv* env, jclass) {
    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    std::shared_ptr<Promise<void>> revokeAccessPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        loginPromise = std::move(gLoginPromise);
        scopesPromise = std::move(gScopesPromise);
        refreshPromise = std::move(gRefreshPromise);
        silentPromise = std::move(gSilentPromise);
        revokeAccessPromise = std::move(gRevokeAccessPromise);
        gLoginGeneration = nextGenerationLocked();
        gScopesGeneration = nextGenerationLocked();
        gRefreshGeneration = nextGenerationLocked();
        gSilentGeneration = nextGenerationLocked();
        gRevokeAccessGeneration = nextGenerationLocked();
    }

    auto disposed = makeAuthError(AuthErrorCode::CANCELLED);
    if (loginPromise) loginPromise->reject(disposed);
    if (scopesPromise) scopesPromise->reject(disposed);
    if (refreshPromise) refreshPromise->reject(disposed);
    if (silentPromise) silentPromise->reject(disposed);
    if (revokeAccessPromise) revokeAccessPromise->reject(disposed);

    clearCachedJniRefs(env);
}

} // namespace margelo::nitro::NitroAuth

#include "PlatformAuth.hpp"
#include "AuthUser.hpp"
#include "AuthTokens.hpp"
#include "AuthCache.hpp"
#include "MicrosoftPrompt.hpp"
#include <fbjni/fbjni.h>
#include <NitroModules/NitroLogger.hpp>
#include <NitroModules/Promise.hpp>
#include <exception>
#include <stdexcept>

namespace margelo::nitro::NitroAuth {

using namespace facebook::jni;

static std::shared_ptr<Promise<AuthUser>> gLoginPromise;
static std::shared_ptr<Promise<AuthUser>> gScopesPromise;
static std::shared_ptr<Promise<AuthTokens>> gRefreshPromise;
static std::shared_ptr<Promise<std::optional<AuthUser>>> gSilentPromise;
static std::mutex gMutex;
static jclass gAuthAdapterClass = nullptr;
static jmethodID gLoginMethod = nullptr;
static jmethodID gRequestScopesMethod = nullptr;
static jmethodID gRefreshMethod = nullptr;
static jmethodID gRestoreMethod = nullptr;
static jmethodID gHasPlayMethod = nullptr;
static jmethodID gLogoutMethod = nullptr;

// Call from JNI_OnUnload or dispose to prevent stale refs after a module reload.
static void clearCachedJniRefs(JNIEnv* env) {
    if (gAuthAdapterClass != nullptr) {
        env->DeleteGlobalRef(gAuthAdapterClass);
        gAuthAdapterClass = nullptr;
    }
    gLoginMethod = nullptr;
    gRequestScopesMethod = nullptr;
    gRefreshMethod = nullptr;
    gRestoreMethod = nullptr;
    gHasPlayMethod = nullptr;
    gLogoutMethod = nullptr;
}

static void ensureAuthAdapterMethods(JNIEnv* env) {
    if (gAuthAdapterClass != nullptr && gLoginMethod != nullptr
        && gRequestScopesMethod != nullptr && gRefreshMethod != nullptr
        && gRestoreMethod != nullptr && gHasPlayMethod != nullptr
        && gLogoutMethod != nullptr) {
        return;
    }

    if (gAuthAdapterClass == nullptr) {
        jclass localAdapterClass = env->FindClass("com/auth/AuthAdapter");
        if (localAdapterClass == nullptr) {
            throw std::runtime_error("Unable to resolve com/auth/AuthAdapter");
        }
        gAuthAdapterClass = static_cast<jclass>(env->NewGlobalRef(localAdapterClass));
        env->DeleteLocalRef(localAdapterClass);
    }

    if (gLoginMethod == nullptr) {
        gLoginMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "loginSync",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;ZZZLjava/lang/String;Ljava/lang/String;)V"
        );
    }
    if (gRequestScopesMethod == nullptr) {
        gRequestScopesMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "requestScopesSync",
            "(Landroid/content/Context;[Ljava/lang/String;)V"
        );
    }
    if (gRefreshMethod == nullptr) {
        gRefreshMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "refreshTokenSync",
            "(Landroid/content/Context;)V"
        );
    }
    if (gRestoreMethod == nullptr) {
        gRestoreMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "restoreSession",
            "(Landroid/content/Context;)V"
        );
    }
    if (gHasPlayMethod == nullptr) {
        gHasPlayMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "hasPlayServices",
            "(Landroid/content/Context;)Z"
        );
    }
    if (gLogoutMethod == nullptr) {
        gLogoutMethod = env->GetStaticMethodID(
            gAuthAdapterClass,
            "logoutSync",
            "(Landroid/content/Context;)V"
        );
    }
}

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
    auto promise = Promise<AuthUser>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(std::make_exception_ptr(std::runtime_error("Android Context not initialized")));
        return promise;
    }

    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gLoginPromise) {
            promise->reject(std::make_exception_ptr(std::runtime_error("operation_in_progress")));
            return promise;
        }
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
    std::optional<std::string> tenant;
    std::optional<std::string> prompt;
    bool useOneTap = false;
    bool forceAccountPicker = false;
    bool useLegacyGoogleSignIn = false;

    if (options) {
        if (options->scopes) scopes = *options->scopes;
        loginHint = options->loginHint;
        tenant = options->tenant;
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
    }

    JNIEnv* env = Environment::current();
    try {
        ensureAuthAdapterMethods(env);
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gLoginPromise = nullptr;
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
    local_ref<JString> tenantRef;
    local_ref<JString> promptRef;

    if (loginHint.has_value()) {
        loginHintRef = make_jstring(loginHint.value());
    }
    if (tenant.has_value()) {
        tenantRef = make_jstring(tenant.value());
    }
    if (prompt.has_value()) {
        promptRef = make_jstring(prompt.value());
    }

    env->CallStaticVoidMethod(gAuthAdapterClass, gLoginMethod,
        contextPtr,
        providerRef.get(),
        nullptr,
        jScopes,
        loginHintRef.get(),
        (jboolean)useOneTap,
        (jboolean)forceAccountPicker,
        (jboolean)useLegacyGoogleSignIn,
        tenantRef.get(),
        promptRef.get());

    env->DeleteLocalRef(jScopes);
    env->DeleteLocalRef(stringClass);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gLoginPromise = nullptr;
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
        promise->reject(std::make_exception_ptr(std::runtime_error("Android Context not initialized")));
        return promise;
    }
    
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gScopesPromise) {
            promise->reject(std::make_exception_ptr(std::runtime_error("operation_in_progress")));
            return promise;
        }
        gScopesPromise = promise;
    }
    
    JNIEnv* env = Environment::current();
    try {
        ensureAuthAdapterMethods(env);
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gScopesPromise = nullptr;
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

    env->CallStaticVoidMethod(gAuthAdapterClass, gRequestScopesMethod, contextPtr, jScopes);
    env->DeleteLocalRef(jScopes);
    env->DeleteLocalRef(stringClass);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gScopesPromise = nullptr;
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
        promise->reject(std::make_exception_ptr(std::runtime_error("Android Context not initialized")));
        return promise;
    }
    
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gRefreshPromise) {
            promise->reject(std::make_exception_ptr(std::runtime_error("operation_in_progress")));
            return promise;
        }
        gRefreshPromise = promise;
    }
    
    JNIEnv* env = Environment::current();
    try {
        ensureAuthAdapterMethods(env);
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gRefreshPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }

    env->CallStaticVoidMethod(gAuthAdapterClass, gRefreshMethod, contextPtr);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gRefreshPromise = nullptr;
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
        promise->resolve(std::nullopt);
        return promise;
    }

    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (gSilentPromise) {
            promise->reject(std::make_exception_ptr(std::runtime_error("operation_in_progress")));
            return promise;
        }
        gSilentPromise = promise;
    }

    JNIEnv* env = Environment::current();
    try {
        ensureAuthAdapterMethods(env);
    } catch (...) {
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gSilentPromise = nullptr;
        }
        promise->reject(std::current_exception());
        return promise;
    }

    env->CallStaticVoidMethod(gAuthAdapterClass, gRestoreMethod, contextPtr);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        {
            std::lock_guard<std::mutex> lock(gMutex);
            gSilentPromise = nullptr;
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
    try {
        ensureAuthAdapterMethods(env);
    } catch (...) {
        return false;
    }

    jboolean result = env->CallStaticBooleanMethod(gAuthAdapterClass, gHasPlayMethod, contextPtr);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        return false;
    }

    return result;
}

void PlatformAuth::logout() {
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) return;

    JNIEnv* env = Environment::current();
    try {
        ensureAuthAdapterMethods(env);
    } catch (...) {
        return;
    }

    env->CallStaticVoidMethod(gAuthAdapterClass, gLogoutMethod, contextPtr);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeInitialize(JNIEnv*, jclass, jobject context) {
    AuthCache::setAndroidContext(context);
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeOnLoginSuccess(
    JNIEnv* env, jclass,
    jstring origin, jstring provider, jstring email, jstring name, jstring photo, jstring idToken, jstring accessToken, jstring serverAuthCode, jobjectArray scopes, jobject expirationTime) {

    const char* originCStr = env->GetStringUTFChars(origin, nullptr);
    std::string originStr(originCStr);
    env->ReleaseStringUTFChars(origin, originCStr);

    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (originStr == "login") {
            loginPromise = gLoginPromise;
            gLoginPromise = nullptr;
        } else if (originStr == "scopes") {
            scopesPromise = gScopesPromise;
            gScopesPromise = nullptr;
        } else if (originStr == "silent") {
            silentPromise = gSilentPromise;
            gSilentPromise = nullptr;
        }
    }

    AuthUser user;
    const char* providerCStr = env->GetStringUTFChars(provider, nullptr);
    std::string providerStr(providerCStr);
    if (providerStr == "google") {
        user.provider = AuthProvider::GOOGLE;
    } else if (providerStr == "microsoft") {
        user.provider = AuthProvider::MICROSOFT;
    } else {
        user.provider = AuthProvider::APPLE;
    }
    env->ReleaseStringUTFChars(provider, providerCStr);
    
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
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeOnLoginError(
    JNIEnv* env, jclass, jstring origin, jstring error, jstring underlyingError) {

    const char* originCStr = env->GetStringUTFChars(origin, nullptr);
    std::string originStr(originCStr);
    env->ReleaseStringUTFChars(origin, originCStr);

    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        if (originStr == "login") {
            loginPromise = gLoginPromise;
            gLoginPromise = nullptr;
        } else if (originStr == "scopes") {
            scopesPromise = gScopesPromise;
            gScopesPromise = nullptr;
        } else if (originStr == "silent") {
            silentPromise = gSilentPromise;
            gSilentPromise = nullptr;
        }
    }
    
    const char* errorCStr = env->GetStringUTFChars(error, nullptr);
    std::string errorStr(errorCStr);
    env->ReleaseStringUTFChars(error, errorCStr);

    // errorStr is the structured AuthErrorCode (e.g. "cancelled", "network_error").
    // underlyingError is a raw platform message for debugging — it must not replace the code.
    if (underlyingError) {
        const char* uCStr = env->GetStringUTFChars(underlyingError, nullptr);
        env->ReleaseStringUTFChars(underlyingError, uCStr);
        // underlyingError is intentionally discarded here; the structured code is sufficient
        // for consumers. If richer debugging is needed, add it to the AuthUser.underlyingError field.
    }

    if (loginPromise) loginPromise->reject(std::make_exception_ptr(std::runtime_error(errorStr)));
    if (scopesPromise) scopesPromise->reject(std::make_exception_ptr(std::runtime_error(errorStr)));
    if (silentPromise) {
        if (errorStr == "No session") silentPromise->resolve(std::nullopt);
        else silentPromise->reject(std::make_exception_ptr(std::runtime_error(errorStr)));
    }
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeOnRefreshSuccess(
    JNIEnv* env, jclass, jstring idToken, jstring accessToken, jobject expirationTime) {
    
    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        refreshPromise = gRefreshPromise;
        gRefreshPromise = nullptr;
    }
    
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
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeOnRefreshError(
    JNIEnv* env, jclass, jstring error, jstring underlyingError) {
    
    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        refreshPromise = gRefreshPromise;
        gRefreshPromise = nullptr;
    }
    if (refreshPromise) {
        const char* errorCStr = env->GetStringUTFChars(error, nullptr);
        std::string errorStr(errorCStr);
        env->ReleaseStringUTFChars(error, errorCStr);

        if (underlyingError) {
            const char* uCStr = env->GetStringUTFChars(underlyingError, nullptr);
            env->ReleaseStringUTFChars(underlyingError, uCStr);
        }
        refreshPromise->reject(std::make_exception_ptr(std::runtime_error(errorStr)));
    }
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeDispose(JNIEnv* env, jclass) {
    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<AuthTokens>> refreshPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        loginPromise = std::move(gLoginPromise);
        scopesPromise = std::move(gScopesPromise);
        refreshPromise = std::move(gRefreshPromise);
        silentPromise = std::move(gSilentPromise);
        gLoginPromise = nullptr;
        gScopesPromise = nullptr;
        gRefreshPromise = nullptr;
        gSilentPromise = nullptr;
    }

    auto disposed = std::make_exception_ptr(std::runtime_error("disposed"));
    if (loginPromise) loginPromise->reject(disposed);
    if (scopesPromise) scopesPromise->reject(disposed);
    if (refreshPromise) refreshPromise->reject(disposed);
    if (silentPromise) silentPromise->reject(disposed);

    clearCachedJniRefs(env);
}

} // namespace margelo::nitro::NitroAuth

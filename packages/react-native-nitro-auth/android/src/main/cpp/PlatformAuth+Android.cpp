#include "PlatformAuth.hpp"
#include "AuthUser.hpp"
#include "AuthTokens.hpp"
#include "AuthCache.hpp"
#include "MicrosoftPrompt.hpp"
#include <fbjni/fbjni.h>
#include <NitroModules/NitroLogger.hpp>
#include <NitroModules/Promise.hpp>

namespace margelo::nitro::NitroAuth {

using namespace facebook::jni;

struct JContext : JavaClass<JContext> {
    static constexpr auto kJavaDescriptor = "Landroid/content/Context;";
};

struct JAuthAdapter : JavaClass<JAuthAdapter> {
    static constexpr auto kJavaDescriptor = "Lcom/auth/AuthAdapter;";
};

static std::shared_ptr<Promise<AuthUser>> gLoginPromise;
static std::shared_ptr<Promise<AuthUser>> gScopesPromise;
static std::shared_ptr<Promise<AuthTokens>> gRefreshPromise;
static std::shared_ptr<Promise<std::optional<AuthUser>>> gSilentPromise;
static std::mutex gMutex;

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
    auto promise = Promise<AuthUser>::create();
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) {
        promise->reject(std::make_exception_ptr(std::runtime_error("Android Context not initialized")));
        return promise;
    }
    
    {
        std::lock_guard<std::mutex> lock(gMutex);
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
    }

    JNIEnv* env = Environment::current();
    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray jScopes = env->NewObjectArray(scopes.size(), stringClass, nullptr);
    for (size_t i = 0; i < scopes.size(); i++) {
        env->SetObjectArrayElement(jScopes, i, make_jstring(scopes[i]).get());
    }
    
    jstring jLoginHint = loginHint.has_value() ? make_jstring(loginHint.value()).get() : nullptr;
    jstring jTenant = tenant.has_value() ? make_jstring(tenant.value()).get() : nullptr;
    jstring jPrompt = prompt.has_value() ? make_jstring(prompt.value()).get() : nullptr;
    
    jclass adapterClass = env->FindClass("com/auth/AuthAdapter");
    jmethodID loginMethod = env->GetStaticMethodID(adapterClass, "loginSync", 
        "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;ZZLjava/lang/String;Ljava/lang/String;)V");
    env->CallStaticVoidMethod(adapterClass, loginMethod, 
        contextPtr, 
        make_jstring(providerStr).get(),
        nullptr,
        jScopes,
        jLoginHint,
        (jboolean)useOneTap,
        (jboolean)forceAccountPicker,
        jTenant,
        jPrompt);
    
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
        gScopesPromise = promise;
    }
    
    JNIEnv* env = Environment::current();
    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray jScopes = env->NewObjectArray(scopes.size(), stringClass, nullptr);
    for (size_t i = 0; i < scopes.size(); i++) {
        env->SetObjectArrayElement(jScopes, i, make_jstring(scopes[i]).get());
    }
    
    jclass adapterClass = env->FindClass("com/auth/AuthAdapter");
    jmethodID requestMethod = env->GetStaticMethodID(adapterClass, "requestScopesSync", 
        "(Landroid/content/Context;[Ljava/lang/String;)V");
    env->CallStaticVoidMethod(adapterClass, requestMethod, contextPtr, jScopes);
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
        gRefreshPromise = promise;
    }
    
    auto jContext = wrap_alias(contextPtr);
    static auto refreshMethod = JAuthAdapter::javaClassStatic()->getStaticMethod<void(alias_ref<JContext>)>("refreshTokenSync");
    refreshMethod(JAuthAdapter::javaClassStatic(), static_ref_cast<JContext>(jContext));
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
        gSilentPromise = promise;
    }

    auto jContext = wrap_alias(contextPtr);
    static auto restoreMethod = JAuthAdapter::javaClassStatic()->getStaticMethod<void(alias_ref<JContext>)>("restoreSession");
    restoreMethod(JAuthAdapter::javaClassStatic(), static_ref_cast<JContext>(jContext));
    return promise;
}

bool PlatformAuth::hasPlayServices() {
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) return false;
    
    auto jContext = wrap_alias(contextPtr);
    static auto hasPlayMethod = JAuthAdapter::javaClassStatic()->getStaticMethod<jboolean(alias_ref<JContext>)>("hasPlayServices");
    return hasPlayMethod(JAuthAdapter::javaClassStatic(), static_ref_cast<JContext>(jContext));
}

void PlatformAuth::logout() {
    auto contextPtr = static_cast<jobject>(AuthCache::getAndroidContext());
    if (!contextPtr) return;

    auto jContext = wrap_alias(contextPtr);
    static auto logoutMethod = JAuthAdapter::javaClassStatic()->getStaticMethod<void(alias_ref<JContext>)>("logoutSync");
    logoutMethod(JAuthAdapter::javaClassStatic(), static_ref_cast<JContext>(jContext));
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeInitialize(JNIEnv* env, jclass, jobject context) {
    AuthCache::setAndroidContext(env->NewGlobalRef(context));
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeOnLoginSuccess(
    JNIEnv* env, jclass, 
    jstring provider, jstring email, jstring name, jstring photo, jstring idToken, jstring accessToken, jstring serverAuthCode, jobjectArray scopes, jobject expirationTime) {
    
    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        loginPromise = gLoginPromise;
        gLoginPromise = nullptr;
        scopesPromise = gScopesPromise;
        gScopesPromise = nullptr;
        silentPromise = gSilentPromise;
        gSilentPromise = nullptr;
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
        }
        user.scopes = scopeVec;
    }
    if (expirationTime) {
        jclass longClass = env->FindClass("java/lang/Long");
        jmethodID longValueMethod = env->GetMethodID(longClass, "longValue", "()J");
        user.expirationTime = (double)env->CallLongMethod(expirationTime, longValueMethod);
    }
    
    if (loginPromise) loginPromise->resolve(user);
    if (scopesPromise) scopesPromise->resolve(user);
    if (silentPromise) silentPromise->resolve(user);
}

extern "C" JNIEXPORT void JNICALL Java_com_auth_AuthAdapter_nativeOnLoginError(
    JNIEnv* env, jclass, jstring error, jstring underlyingError) {
    
    std::shared_ptr<Promise<AuthUser>> loginPromise;
    std::shared_ptr<Promise<AuthUser>> scopesPromise;
    std::shared_ptr<Promise<std::optional<AuthUser>>> silentPromise;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        loginPromise = gLoginPromise;
        gLoginPromise = nullptr;
        scopesPromise = gScopesPromise;
        gScopesPromise = nullptr;
        silentPromise = gSilentPromise;
        gSilentPromise = nullptr;
    }
    
    const char* errorCStr = env->GetStringUTFChars(error, nullptr);
    std::string errorStr(errorCStr);
    env->ReleaseStringUTFChars(error, errorCStr);
    
    std::string finalError = errorStr;
    if (underlyingError) {
        const char* uCStr = env->GetStringUTFChars(underlyingError, nullptr);
        finalError = std::string(uCStr);
        env->ReleaseStringUTFChars(underlyingError, uCStr);
    }

    if (loginPromise) loginPromise->reject(std::make_exception_ptr(std::runtime_error(finalError)));
    if (scopesPromise) scopesPromise->reject(std::make_exception_ptr(std::runtime_error(finalError)));
    if (silentPromise) {
        if (errorStr == "No session") silentPromise->resolve(std::nullopt);
        else silentPromise->reject(std::make_exception_ptr(std::runtime_error(finalError)));
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
        std::string finalError;
        const char* errorCStr = env->GetStringUTFChars(error, nullptr);
        finalError = std::string(errorCStr);
        env->ReleaseStringUTFChars(error, errorCStr);
        
        if (underlyingError) {
            const char* uCStr = env->GetStringUTFChars(underlyingError, nullptr);
            finalError = std::string(uCStr);
            env->ReleaseStringUTFChars(underlyingError, uCStr);
        }
        refreshPromise->reject(std::make_exception_ptr(std::runtime_error(finalError)));
    }
}

} // namespace margelo::nitro::NitroAuth

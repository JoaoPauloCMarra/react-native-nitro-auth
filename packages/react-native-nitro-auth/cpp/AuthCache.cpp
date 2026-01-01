#include "AuthCache.hpp"

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

#ifdef __ANDROID__
#include <jni.h>
#include <fbjni/fbjni.h>
#endif

namespace margelo::nitro::NitroAuth {

static const char* CACHE_KEY = "nitro_auth_user";

#ifdef __APPLE__
void AuthCache::setUserJson(const std::string& json) {
    CFStringRef key = CFStringCreateWithCString(nullptr, CACHE_KEY, kCFStringEncodingUTF8);
    CFStringRef value = CFStringCreateWithCString(nullptr, json.c_str(), kCFStringEncodingUTF8);
    CFPreferencesSetAppValue(key, value, kCFPreferencesCurrentApplication);
    CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
    CFRelease(key);
    CFRelease(value);
}

std::optional<std::string> AuthCache::getUserJson() {
    CFStringRef key = CFStringCreateWithCString(nullptr, CACHE_KEY, kCFStringEncodingUTF8);
    CFPropertyListRef value = CFPreferencesCopyAppValue(key, kCFPreferencesCurrentApplication);
    CFRelease(key);

    if (value && CFGetTypeID(value) == CFStringGetTypeID()) {
        CFStringRef cfStr = (CFStringRef)value;
        char buffer[4096];
        if (CFStringGetCString(cfStr, buffer, sizeof(buffer), kCFStringEncodingUTF8)) {
            CFRelease(value);
            return std::string(buffer);
        }
    }
    if (value) CFRelease(value);
    return std::nullopt;
}

void AuthCache::clear() {
    CFStringRef key = CFStringCreateWithCString(nullptr, CACHE_KEY, kCFStringEncodingUTF8);
    CFPreferencesSetAppValue(key, nullptr, kCFPreferencesCurrentApplication);
    CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
    CFRelease(key);
}
#endif

#ifdef __ANDROID__
using namespace facebook::jni;

struct JContext : JavaClass<JContext> {
    static constexpr auto kJavaDescriptor = "Landroid/content/Context;";
};

struct JAuthAdapter : facebook::jni::JavaClass<JAuthAdapter> {
    static constexpr auto kJavaDescriptor = "Lcom/auth/AuthAdapter;";
    
    static void setUserJson(facebook::jni::alias_ref<jobject> context, const std::string& json) {
        static auto method = javaClassStatic()->getStaticMethod<void(alias_ref<JContext>, jstring)>("setUserJson");
        method(javaClassStatic(), static_ref_cast<JContext>(context), make_jstring(json).get());
    }

    static facebook::jni::local_ref<jstring> getUserJson(facebook::jni::alias_ref<jobject> context) {
        static auto method = javaClassStatic()->getStaticMethod<jstring(alias_ref<JContext>)>("getUserJson");
        return method(javaClassStatic(), static_ref_cast<JContext>(context));
    }

    static void clearUser(facebook::jni::alias_ref<jobject> context) {
        static auto method = javaClassStatic()->getStaticMethod<void(alias_ref<JContext>)>("clearUser");
        method(javaClassStatic(), static_ref_cast<JContext>(context));
    }
};

static facebook::jni::global_ref<jobject> gContext;

void AuthCache::setAndroidContext(void* context) {
    gContext = facebook::jni::make_global(static_cast<jobject>(context));
}

void* AuthCache::getAndroidContext() {
    return gContext.get();
}

void AuthCache::setUserJson(const std::string& json) {
    if (!gContext) return;
    JAuthAdapter::setUserJson(gContext, json);
}

std::optional<std::string> AuthCache::getUserJson() {
    if (!gContext) return std::nullopt;
    auto result = JAuthAdapter::getUserJson(gContext);
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AuthCache::clear() {
    if (!gContext) return;
    JAuthAdapter::clearUser(gContext);
}
#endif

} // namespace margelo::nitro::NitroAuth

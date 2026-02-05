#include "AuthCache.hpp"

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#endif

#ifdef __ANDROID__
#include <jni.h>
#include <fbjni/fbjni.h>
#endif

namespace margelo::nitro::NitroAuth {

#ifdef __APPLE__
static CFStringRef kService = CFSTR("react-native-nitro-auth");
static CFStringRef kAccount = CFSTR("nitro_auth_user");
static CFStringRef kLegacyCacheKey = CFSTR("nitro_auth_user");

static CFMutableDictionaryRef createKeychainQuery() {
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(
        kCFAllocatorDefault,
        0,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, kService);
    CFDictionarySetValue(query, kSecAttrAccount, kAccount);
    return query;
}

static std::optional<std::string> getLegacyUserJson() {
    CFPropertyListRef value = CFPreferencesCopyAppValue(kLegacyCacheKey, kCFPreferencesCurrentApplication);
    if (value && CFGetTypeID(value) == CFStringGetTypeID()) {
        CFStringRef cfStr = static_cast<CFStringRef>(value);
        char buffer[4096];
        if (CFStringGetCString(cfStr, buffer, sizeof(buffer), kCFStringEncodingUTF8)) {
            CFRelease(value);
            return std::string(buffer);
        }
    }
    if (value) CFRelease(value);
    return std::nullopt;
}

static void clearLegacyUserJson() {
    CFPreferencesSetAppValue(kLegacyCacheKey, nullptr, kCFPreferencesCurrentApplication);
    CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
}

void AuthCache::setUserJson(const std::string& json) {
    CFMutableDictionaryRef query = createKeychainQuery();
    SecItemDelete(query);

    CFDataRef data = CFDataCreate(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(json.data()),
        static_cast<CFIndex>(json.size())
    );
    CFDictionarySetValue(query, kSecValueData, data);
    CFDictionarySetValue(query, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);

    SecItemAdd(query, nullptr);
    CFRelease(data);
    CFRelease(query);
}

std::optional<std::string> AuthCache::getUserJson() {
    CFMutableDictionaryRef query = createKeychainQuery();
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

    CFTypeRef result = nullptr;
    OSStatus status = SecItemCopyMatching(query, &result);
    CFRelease(query);

    if (status != errSecSuccess || result == nullptr) {
        if (result) CFRelease(result);
        auto legacy = getLegacyUserJson();
        if (legacy) {
            AuthCache::setUserJson(*legacy);
            clearLegacyUserJson();
            return legacy;
        }
        return std::nullopt;
    }

    CFDataRef data = static_cast<CFDataRef>(result);
    const UInt8* bytes = CFDataGetBytePtr(data);
    const CFIndex length = CFDataGetLength(data);
    std::string value(reinterpret_cast<const char*>(bytes), static_cast<size_t>(length));
    CFRelease(result);
    return value;
}

void AuthCache::clear() {
    CFMutableDictionaryRef query = createKeychainQuery();
    SecItemDelete(query);
    CFRelease(query);
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

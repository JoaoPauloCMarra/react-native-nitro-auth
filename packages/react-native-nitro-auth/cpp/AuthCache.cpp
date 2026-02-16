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
static std::string sInMemoryUserJson;

void AuthCache::setUserJson(const std::string& json) {
    sInMemoryUserJson = json;
}

std::optional<std::string> AuthCache::getUserJson() {
    if (sInMemoryUserJson.empty()) {
        return std::nullopt;
    }
    return sInMemoryUserJson;
}

void AuthCache::clear() {
    sInMemoryUserJson.clear();
}
#endif

#ifdef __ANDROID__
using namespace facebook::jni;

struct JContext : JavaClass<JContext> {
    static constexpr auto kJavaDescriptor = "Landroid/content/Context;";
};

static facebook::jni::global_ref<jobject> gContext;
static std::string sInMemoryUserJson;

void AuthCache::setAndroidContext(void* context) {
    gContext = facebook::jni::make_global(static_cast<jobject>(context));
}

void* AuthCache::getAndroidContext() {
    return gContext.get();
}

void AuthCache::setUserJson(const std::string& json) {
    sInMemoryUserJson = json;
}

std::optional<std::string> AuthCache::getUserJson() {
    if (sInMemoryUserJson.empty()) {
        return std::nullopt;
    }
    return sInMemoryUserJson;
}

void AuthCache::clear() {
    sInMemoryUserJson.clear();
}
#endif

} // namespace margelo::nitro::NitroAuth

#include "AuthCache.hpp"

#ifdef __ANDROID__
#include <jni.h>
#include <fbjni/fbjni.h>
#endif

namespace margelo::nitro::NitroAuth {

#ifdef __ANDROID__
using namespace facebook::jni;

static facebook::jni::global_ref<jobject> gContext;

void AuthCache::setAndroidContext(void* context) {
    gContext = facebook::jni::make_global(static_cast<jobject>(context));
}

void* AuthCache::getAndroidContext() {
    return gContext.get();
}
#endif

} // namespace margelo::nitro::NitroAuth

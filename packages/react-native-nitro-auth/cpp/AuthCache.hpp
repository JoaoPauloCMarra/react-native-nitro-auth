#pragma once

namespace margelo::nitro::NitroAuth {

class AuthCache {
public:
#ifdef __ANDROID__
  static void setAndroidContext(void* context);
  static void* getAndroidContext();
#endif
};

} // namespace margelo::nitro::NitroAuth

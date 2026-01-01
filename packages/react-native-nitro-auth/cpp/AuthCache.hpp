#pragma once

#include <string>
#include <optional>

namespace margelo::nitro::NitroAuth {

class AuthCache {
public:
  static void setUserJson(const std::string& json);
  static std::optional<std::string> getUserJson();
  static void clear();

#ifdef __ANDROID__
  static void setAndroidContext(void* context);
  static void* getAndroidContext();
#endif
};

} // namespace margelo::nitro::NitroAuth

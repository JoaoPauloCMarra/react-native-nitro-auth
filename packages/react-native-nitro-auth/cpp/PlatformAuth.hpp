#pragma once

#include "AuthProvider.hpp"
#include "AuthUser.hpp"
#include "AuthTokens.hpp"
#include "LoginOptions.hpp"
#include <NitroModules/Promise.hpp>
#include <memory>
#include <vector>
#include <string>

namespace margelo::nitro::NitroAuth {

using namespace margelo::nitro;

class PlatformAuth {
public:
  static std::shared_ptr<Promise<AuthUser>> login(AuthProvider provider, const std::optional<LoginOptions>& options = std::nullopt);
  static std::shared_ptr<Promise<AuthUser>> requestScopes(const std::vector<std::string>& scopes);
  static std::shared_ptr<Promise<AuthTokens>> refreshToken();
  static std::shared_ptr<Promise<std::optional<AuthUser>>> silentRestore();
  static bool hasPlayServices();
  static void logout();
};

} // namespace margelo::nitro::NitroAuth

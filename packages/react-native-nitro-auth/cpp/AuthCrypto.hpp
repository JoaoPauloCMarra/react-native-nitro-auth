#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace NitroAuth {

std::optional<std::string> decodeJwtPayloadJson(std::string_view jwt);

} // namespace NitroAuth

#ifdef __cplusplus
extern "C" {
#endif

int NitroAuthJwtPayloadJson(const char* jwt, char* out, size_t outCap);

#ifdef __cplusplus
}
#endif

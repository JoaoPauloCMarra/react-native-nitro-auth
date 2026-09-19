#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace NitroAuth {

std::string sha256Hex(std::string_view input);
std::optional<std::string> decodeJwtPayloadJson(std::string_view jwt);

} // namespace NitroAuth

#ifdef __cplusplus
extern "C" {
#endif

int NitroAuthSha256Hex(const char* input, size_t len, char* outHex, size_t outCap);
int NitroAuthJwtPayloadJson(const char* jwt, char* out, size_t outCap);

#ifdef __cplusplus
}
#endif

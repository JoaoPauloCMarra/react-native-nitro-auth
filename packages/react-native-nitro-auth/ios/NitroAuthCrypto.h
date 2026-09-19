#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

int NitroAuthSha256Hex(const char* input, size_t len, char* outHex, size_t outCap);
int NitroAuthJwtPayloadJson(const char* jwt, char* out, size_t outCap);

#ifdef __cplusplus
}
#endif

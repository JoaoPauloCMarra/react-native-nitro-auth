#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

int NitroAuthJwtPayloadJson(const char* jwt, char* out, size_t outCap);

#ifdef __cplusplus
}
#endif

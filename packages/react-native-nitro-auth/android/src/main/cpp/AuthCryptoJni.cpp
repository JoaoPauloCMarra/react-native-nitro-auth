#include <jni.h>

#include <string>
#include <string_view>

#include "AuthCrypto.hpp"

extern "C" JNIEXPORT jstring JNICALL
Java_com_auth_AuthCrypto_sha256Hex(JNIEnv* env, jclass, jstring input) {
    if (input == nullptr) {
        return env->NewStringUTF("");
    }
    const char* bytes = env->GetStringUTFChars(input, nullptr);
    if (bytes == nullptr) {
        return env->NewStringUTF("");
    }
    const jsize length = env->GetStringUTFLength(input);
    const std::string hex = NitroAuth::sha256Hex(std::string_view(bytes, static_cast<size_t>(length)));
    env->ReleaseStringUTFChars(input, bytes);
    return env->NewStringUTF(hex.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_auth_AuthCrypto_jwtPayloadJson(JNIEnv* env, jclass, jstring jwt) {
    if (jwt == nullptr) {
        return nullptr;
    }
    const char* bytes = env->GetStringUTFChars(jwt, nullptr);
    if (bytes == nullptr) {
        return nullptr;
    }
    const auto payload = NitroAuth::decodeJwtPayloadJson(bytes);
    env->ReleaseStringUTFChars(jwt, bytes);
    if (!payload.has_value()) {
        return nullptr;
    }
    return env->NewStringUTF(payload->c_str());
}

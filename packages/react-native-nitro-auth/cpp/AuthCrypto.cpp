#include "AuthCrypto.hpp"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <limits>

namespace NitroAuth {
namespace {

int base64UrlValue(char character) {
    if (character >= 'A' && character <= 'Z') return character - 'A';
    if (character >= 'a' && character <= 'z') return character - 'a' + 26;
    if (character >= '0' && character <= '9') return character - '0' + 52;
    if (character == '-' || character == '+') return 62;
    if (character == '_' || character == '/') return 63;
    return -1;
}

std::optional<std::string> decodeBase64Url(std::string_view input) {
    std::string padded(input);
    padded.erase(
        std::remove_if(padded.begin(), padded.end(), [](unsigned char character) {
            return character == '=';
        }),
        padded.end()
    );
    if (padded.empty()) {
        return std::string();
    }

    std::string output;
    output.reserve((padded.size() * 3) / 4);
    uint32_t value = 0;
    int bits = 0;
    for (const char character : padded) {
        const int decoded = base64UrlValue(character);
        if (decoded < 0) {
            return std::nullopt;
        }
        value = (value << 6) | static_cast<uint32_t>(decoded);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output.push_back(static_cast<char>((value >> bits) & 0xff));
        }
    }
    return output;
}

} // namespace

std::optional<std::string> decodeJwtPayloadJson(std::string_view jwt) {
    const size_t first = jwt.find('.');
    if (first == std::string_view::npos) {
        return std::nullopt;
    }
    const size_t second = jwt.find('.', first + 1);
    if (second == std::string_view::npos || second == first + 1) {
        return std::nullopt;
    }
    return decodeBase64Url(jwt.substr(first + 1, second - first - 1));
}

} // namespace NitroAuth

extern "C" int NitroAuthJwtPayloadJson(const char* jwt, char* out, size_t outCap) {
    if (jwt == nullptr || out == nullptr || outCap == 0) {
        return -1;
    }
    const auto payload = NitroAuth::decodeJwtPayloadJson(jwt);
    if (!payload.has_value() || payload->size() >= outCap ||
        payload->size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
        return -1;
    }
    std::memcpy(out, payload->data(), payload->size());
    out[payload->size()] = '\0';
    return static_cast<int>(payload->size());
}

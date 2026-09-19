#include "AuthCrypto.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <vector>

namespace NitroAuth {
namespace {

constexpr uint32_t kSha256K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

uint32_t rotr(uint32_t value, uint32_t bits) {
    return (value >> bits) | (value << (32 - bits));
}

std::array<uint8_t, 32> sha256(std::string_view input) {
    uint64_t bitLength = static_cast<uint64_t>(input.size()) * 8;
    std::vector<uint8_t> message(input.begin(), input.end());
    message.push_back(0x80);
    while ((message.size() % 64) != 56) {
        message.push_back(0);
    }
    for (int shift = 56; shift >= 0; shift -= 8) {
        message.push_back(static_cast<uint8_t>((bitLength >> shift) & 0xff));
    }

    uint32_t hash[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    };

    for (size_t offset = 0; offset < message.size(); offset += 64) {
        uint32_t w[64];
        for (int i = 0; i < 16; ++i) {
            w[i] = (static_cast<uint32_t>(message[offset + i * 4]) << 24) |
                (static_cast<uint32_t>(message[offset + i * 4 + 1]) << 16) |
                (static_cast<uint32_t>(message[offset + i * 4 + 2]) << 8) |
                static_cast<uint32_t>(message[offset + i * 4 + 3]);
        }
        for (int i = 16; i < 64; ++i) {
            const uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            const uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        uint32_t a = hash[0], b = hash[1], c = hash[2], d = hash[3];
        uint32_t e = hash[4], f = hash[5], g = hash[6], h = hash[7];
        for (int i = 0; i < 64; ++i) {
            const uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const uint32_t ch = (e & f) ^ ((~e) & g);
            const uint32_t temp1 = h + S1 + ch + kSha256K[i] + w[i];
            const uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            const uint32_t temp2 = S0 + maj;
            h = g;
            g = f;
            f = e;
            e = d + temp1;
            d = c;
            c = b;
            b = a;
            a = temp1 + temp2;
        }
        hash[0] += a;
        hash[1] += b;
        hash[2] += c;
        hash[3] += d;
        hash[4] += e;
        hash[5] += f;
        hash[6] += g;
        hash[7] += h;
    }

    std::array<uint8_t, 32> digest{};
    for (int i = 0; i < 8; ++i) {
        digest[i * 4] = static_cast<uint8_t>((hash[i] >> 24) & 0xff);
        digest[i * 4 + 1] = static_cast<uint8_t>((hash[i] >> 16) & 0xff);
        digest[i * 4 + 2] = static_cast<uint8_t>((hash[i] >> 8) & 0xff);
        digest[i * 4 + 3] = static_cast<uint8_t>(hash[i] & 0xff);
    }
    return digest;
}

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
    int value = 0;
    int bits = 0;
    for (const char character : padded) {
        const int decoded = base64UrlValue(character);
        if (decoded < 0) {
            return std::nullopt;
        }
        value = (value << 6) | decoded;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output.push_back(static_cast<char>((value >> bits) & 0xff));
        }
    }
    return output;
}

} // namespace

std::string sha256Hex(std::string_view input) {
    const auto digest = sha256(input);
    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    hex.resize(64);
    for (size_t index = 0; index < digest.size(); ++index) {
        hex[index * 2] = kHex[(digest[index] >> 4) & 0x0f];
        hex[index * 2 + 1] = kHex[digest[index] & 0x0f];
    }
    return hex;
}

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

extern "C" int NitroAuthSha256Hex(const char* input, size_t len, char* outHex, size_t outCap) {
    if (input == nullptr || outHex == nullptr || outCap < 65) {
        return -1;
    }
    const std::string hex = NitroAuth::sha256Hex(std::string_view(input, len));
    std::memcpy(outHex, hex.c_str(), 64);
    outHex[64] = '\0';
    return 0;
}

extern "C" int NitroAuthJwtPayloadJson(const char* jwt, char* out, size_t outCap) {
    if (jwt == nullptr || out == nullptr || outCap == 0) {
        return -1;
    }
    const auto payload = NitroAuth::decodeJwtPayloadJson(jwt);
    if (!payload.has_value() || payload->size() + 1 > outCap) {
        return -1;
    }
    std::memcpy(out, payload->data(), payload->size());
    out[payload->size()] = '\0';
    return static_cast<int>(payload->size());
}

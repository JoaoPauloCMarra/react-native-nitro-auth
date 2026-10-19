#include "../AuthCrypto.hpp"

#include <atomic>
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {

std::string base64UrlEncode(const std::string& input, bool standardAlphabet = false, bool padded = false) {
    const char* alphabet = standardAlphabet
        ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    std::string output;
    unsigned int value = 0;
    int bits = 0;
    for (const unsigned char byte : input) {
        value = ((value << 8) | byte) & 0xffffff;
        bits += 8;
        while (bits >= 6) {
            bits -= 6;
            output.push_back(alphabet[(value >> bits) & 0x3f]);
        }
    }
    if (bits > 0) {
        output.push_back(alphabet[(value << (6 - bits)) & 0x3f]);
    }
    while (padded && output.size() % 4 != 0) {
        output.push_back('=');
    }
    return output;
}

std::string jwtFor(const std::string& payload) {
    return "eyJhbGciOiJub25lIn0." + base64UrlEncode(payload) + ".sig";
}

void testJwtStructure() {
    const std::string payload = R"({"nonce":"n1","exp":1})";
    const std::string jwt = "eyJhbGciOiJub25lIn0.eyJub25jZSI6Im4xIiwiZXhwIjoxfQ.sig";
    assert(NitroAuth::decodeJwtPayloadJson(jwt).value() == payload);

    for (const char* malformed : {"", ".", "..", "not-a-jwt", "only-one.", "a.b", "a..c", ".."}) {
        assert(!NitroAuth::decodeJwtPayloadJson(malformed).has_value());
    }

    assert(NitroAuth::decodeJwtPayloadJson(".e30.").value() == "{}");
    assert(NitroAuth::decodeJwtPayloadJson("a.e30.c.d.e").value() == "{}");
    assert(NitroAuth::decodeJwtPayloadJson("a.e30.").value() == "{}");
}

void testJwtBase64Edges() {
    for (const char* invalid : {"a.!!!!.c", "a.e3 0.c", "a.e30\n.c", "a.e30*.c", "a.\xc3\xa9.c", "a.e3\x80.c"}) {
        assert(!NitroAuth::decodeJwtPayloadJson(invalid).has_value());
    }

    assert(NitroAuth::decodeJwtPayloadJson("a.=.c").value().empty());
    assert(NitroAuth::decodeJwtPayloadJson("a.====.c").value().empty());
    assert(NitroAuth::decodeJwtPayloadJson("a.A.c").value().empty());
    assert(NitroAuth::decodeJwtPayloadJson("a.e30=.c").value() == "{}");
    assert(NitroAuth::decodeJwtPayloadJson("a.e30==.c").value() == "{}");
    assert(NitroAuth::decodeJwtPayloadJson("a.e=3=0.c").value() == "{}");

    const std::string binary("\xfb\xff\xbf\x00\x01", 5);
    assert(NitroAuth::decodeJwtPayloadJson("a." + base64UrlEncode(binary) + ".c").value() == binary);
    assert(NitroAuth::decodeJwtPayloadJson("a." + base64UrlEncode(binary, true) + ".c").value() == binary);
    assert(NitroAuth::decodeJwtPayloadJson("a." + base64UrlEncode(binary, true, true) + ".c").value() == binary);

    for (size_t length = 0; length <= 67; ++length) {
        std::string raw;
        for (size_t index = 0; index < length; ++index) {
            raw.push_back(static_cast<char>((index * 37 + length) & 0xff));
        }
        const auto decoded = NitroAuth::decodeJwtPayloadJson(jwtFor(raw));
        if (length == 0) {
            assert(!decoded.has_value());
        } else {
            assert(decoded.value() == raw);
        }
    }
}

void testJwtNonJsonAndHugePayloads() {
    assert(NitroAuth::decodeJwtPayloadJson(jwtFor("not json")).value() == "not json");
    assert(NitroAuth::decodeJwtPayloadJson(jwtFor("[1,2")).value() == "[1,2");

    const std::string huge = "{\"claim\":\"" + std::string(4 * 1024 * 1024, 'x') + "\"}";
    assert(NitroAuth::decodeJwtPayloadJson(jwtFor(huge)).value() == huge);

    const std::string manyDots(100000, '.');
    assert(!NitroAuth::decodeJwtPayloadJson(manyDots).has_value());
    const std::string longInvalid = "a." + std::string(1 << 20, '!') + ".c";
    assert(!NitroAuth::decodeJwtPayloadJson(longInvalid).has_value());
}

void testJwtCApiBounds() {
    const std::string payload = R"({"nonce":"n1","exp":1})";
    const std::string jwt = jwtFor(payload);

    char json[128];
    assert(NitroAuthJwtPayloadJson(jwt.c_str(), json, sizeof(json)) == static_cast<int>(payload.size()));
    assert(std::string(json) == payload);

    assert(NitroAuthJwtPayloadJson(nullptr, json, sizeof(json)) == -1);
    assert(NitroAuthJwtPayloadJson(jwt.c_str(), nullptr, sizeof(json)) == -1);
    assert(NitroAuthJwtPayloadJson(jwt.c_str(), json, 0) == -1);
    assert(NitroAuthJwtPayloadJson("not-a-jwt", json, sizeof(json)) == -1);
    assert(NitroAuthJwtPayloadJson("a.!!.c", json, sizeof(json)) == -1);

    std::vector<char> guarded(payload.size() + 2, 'Z');
    assert(NitroAuthJwtPayloadJson(jwt.c_str(), guarded.data(), payload.size()) == -1);
    assert(NitroAuthJwtPayloadJson(jwt.c_str(), guarded.data(), 1) == -1);
    for (const char character : guarded) {
        assert(character == 'Z');
    }
    assert(NitroAuthJwtPayloadJson(jwt.c_str(), guarded.data(), payload.size() + 1) == static_cast<int>(payload.size()));
    assert(guarded[payload.size()] == '\0' && guarded[payload.size() + 1] == 'Z');

    char one[1] = {'Z'};
    assert(NitroAuthJwtPayloadJson("a.=.c", one, sizeof(one)) == 0);
    assert(one[0] == '\0');

    const std::string withNul("{\"a\":\"\0\"}", 9);
    char binary[32];
    std::memset(binary, 'Z', sizeof(binary));
    assert(NitroAuthJwtPayloadJson(jwtFor(withNul).c_str(), binary, sizeof(binary)) == 9);
    assert(std::string(binary, 9) == withNul);
    assert(binary[9] == '\0');
}

void testConcurrentCallersShareNoState() {
    const std::string jwt = jwtFor(R"({"sub":"user"})");
    std::atomic<int> failures{0};
    std::vector<std::thread> threads;
    for (int index = 0; index < 8; ++index) {
        threads.emplace_back([&, index] {
            for (int round = 0; round < 200; ++round) {
                if (NitroAuth::decodeJwtPayloadJson(jwt).value_or("") != R"({"sub":"user"})") failures++;
            }
        });
    }
    for (auto& thread : threads) thread.join();
    assert(failures == 0);
}

} // namespace

int main() {
    testJwtStructure();
    testJwtBase64Edges();
    testJwtNonJsonAndHugePayloads();
    testJwtCApiBounds();
    testConcurrentCallersShareNoState();

    std::cout << "AuthCrypto tests passed." << std::endl;
    return 0;
}

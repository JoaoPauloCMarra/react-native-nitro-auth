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

void testSha256KnownVectors() {
    assert(NitroAuth::sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert(NitroAuth::sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert(NitroAuth::sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    assert(NitroAuth::sha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu") ==
        "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
    assert(NitroAuth::sha256Hex(std::string(1000000, 'a')) ==
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}

void testSha256PaddingBoundaries() {
    assert(NitroAuth::sha256Hex(std::string(55, 'a')) == "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
    assert(NitroAuth::sha256Hex(std::string(56, 'a')) == "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
    assert(NitroAuth::sha256Hex(std::string(63, 'a')) == "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34");
    assert(NitroAuth::sha256Hex(std::string(64, 'a')) == "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
    assert(NitroAuth::sha256Hex(std::string(65, 'a')) == "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0");
}

void testSha256HostileBytes() {
    const std::string withNul("a\0b", 3);
    assert(NitroAuth::sha256Hex(withNul) != NitroAuth::sha256Hex("a"));
    assert(NitroAuth::sha256Hex(withNul) != NitroAuth::sha256Hex("ab"));
    const std::string highBytes("\xff\xfe\x80\xc3\x28", 5);
    const std::string hex = NitroAuth::sha256Hex(highBytes);
    assert(hex.size() == 64);
    for (const char character : hex) {
        assert((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'));
    }
    assert(NitroAuth::sha256Hex(std::string(1, '\0')) == "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d");
}

void testSha256CApiBounds() {
    char hex[65];
    assert(NitroAuthSha256Hex("abc", 3, hex, sizeof(hex)) == 0);
    assert(std::string(hex) == NitroAuth::sha256Hex("abc"));
    assert(hex[64] == '\0');

    assert(NitroAuthSha256Hex("", 0, hex, sizeof(hex)) == 0);
    assert(std::string(hex) == NitroAuth::sha256Hex(""));

    assert(NitroAuthSha256Hex("abcdef", 3, hex, sizeof(hex)) == 0);
    assert(std::string(hex) == NitroAuth::sha256Hex("abc"));

    assert(NitroAuthSha256Hex(nullptr, 0, hex, sizeof(hex)) == -1);
    assert(NitroAuthSha256Hex("abc", 3, nullptr, 65) == -1);

    char guarded[66];
    std::memset(guarded, 'Z', sizeof(guarded));
    assert(NitroAuthSha256Hex("abc", 3, guarded, 64) == -1);
    assert(NitroAuthSha256Hex("abc", 3, guarded, 0) == -1);
    for (const char character : guarded) {
        assert(character == 'Z');
    }
    assert(NitroAuthSha256Hex("abc", 3, guarded, 65) == 0);
    assert(guarded[64] == '\0' && guarded[65] == 'Z');
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
            const std::string input(static_cast<size_t>(index) * 31 + 1, static_cast<char>('a' + index));
            const std::string expected = NitroAuth::sha256Hex(input);
            for (int round = 0; round < 200; ++round) {
                if (NitroAuth::sha256Hex(input) != expected) failures++;
                if (NitroAuth::decodeJwtPayloadJson(jwt).value_or("") != R"({"sub":"user"})") failures++;
            }
        });
    }
    for (auto& thread : threads) thread.join();
    assert(failures == 0);
}

} // namespace

int main() {
    testSha256KnownVectors();
    testSha256PaddingBoundaries();
    testSha256HostileBytes();
    testSha256CApiBounds();
    testJwtStructure();
    testJwtBase64Edges();
    testJwtNonJsonAndHugePayloads();
    testJwtCApiBounds();
    testConcurrentCallersShareNoState();

    std::cout << "AuthCrypto tests passed." << std::endl;
    return 0;
}

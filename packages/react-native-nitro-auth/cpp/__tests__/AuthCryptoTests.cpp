#include "../AuthCrypto.hpp"

#include <cassert>
#include <iostream>
#include <string>

int main() {
    const std::string empty = NitroAuth::sha256Hex("");
    assert(empty == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    const std::string abc = NitroAuth::sha256Hex("abc");
    assert(abc == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    char hex[65];
    assert(NitroAuthSha256Hex("abc", 3, hex, sizeof(hex)) == 0);
    assert(std::string(hex) == abc);

    const std::string payload = R"({"nonce":"n1","exp":1})";
    const std::string jwt =
        "eyJhbGciOiJub25lIn0.eyJub25jZSI6Im4xIiwiZXhwIjoxfQ.sig";
    const auto decoded = NitroAuth::decodeJwtPayloadJson(jwt);
    assert(decoded.has_value());
    assert(decoded.value() == payload);

    char json[128];
    const int written = NitroAuthJwtPayloadJson(jwt.c_str(), json, sizeof(json));
    assert(written == static_cast<int>(payload.size()));
    assert(std::string(json) == payload);

    assert(!NitroAuth::decodeJwtPayloadJson("not-a-jwt").has_value());
    assert(!NitroAuth::decodeJwtPayloadJson("only-one.").has_value());

    std::cout << "AuthCrypto tests passed." << std::endl;
    return 0;
}

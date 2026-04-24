#include <iostream>
#include <cassert>
#include <optional>
#include <string>
#include <vector>
#include "../JSONSerializer.hpp"

using namespace margelo::nitro::NitroAuth;

int main() {
    AuthUser user;
    user.provider = AuthProvider::GOOGLE;
    user.email = std::make_optional("test@example.com");
    user.name = std::make_optional("Test User");
    
    std::string json = JSONSerializer::serialize(user);
    std::cout << "Serialized: " << json << std::endl;
    
    auto deserialized = JSONSerializer::deserialize(json);
    assert(deserialized.has_value());
    assert(deserialized->provider == AuthProvider::GOOGLE);
    assert(deserialized->email == "test@example.com");
    assert(deserialized->name == "Test User");

    user.provider = AuthProvider::APPLE;
    user.photo = std::make_optional("https://example.com/avatar.png");
    user.idToken = std::make_optional("id-token");
    user.serverAuthCode = std::make_optional("server-code");
    user.scopes = std::make_optional(std::vector<std::string>{"email", "profile"});

    std::string fullJson = JSONSerializer::serialize(user);
    assert(fullJson.find("\"provider\":\"apple\"") != std::string::npos);
    assert(fullJson.find("\"photo\":\"https://example.com/avatar.png\"") != std::string::npos);
    assert(fullJson.find("\"idToken\":\"id-token\"") != std::string::npos);
    assert(fullJson.find("\"serverAuthCode\":\"server-code\"") != std::string::npos);
    assert(fullJson.find("\"scopes\":[\"email\",\"profile\"]") != std::string::npos);

    auto fullDeserialized = JSONSerializer::deserialize(fullJson);
    assert(fullDeserialized.has_value());
    assert(fullDeserialized->provider == AuthProvider::APPLE);
    assert(fullDeserialized->photo == "https://example.com/avatar.png");
    assert(fullDeserialized->idToken == "id-token");
    assert(fullDeserialized->serverAuthCode == "server-code");

    auto appleWithoutProvider = JSONSerializer::deserialize("{\"email\":\"apple@example.com\"}");
    assert(appleWithoutProvider.has_value());
    assert(appleWithoutProvider->provider == AuthProvider::APPLE);
    assert(appleWithoutProvider->email == "apple@example.com");
    assert(!appleWithoutProvider->name.has_value());

    auto missingQuote = JSONSerializer::deserialize("{\"email\":\"broken}");
    assert(missingQuote.has_value());
    assert(!missingQuote->email.has_value());

    auto invalid = JSONSerializer::deserialize("not json");
    assert(!invalid.has_value());
    
    std::cout << "JSONSerializer tests passed!" << std::endl;
    return 0;
}

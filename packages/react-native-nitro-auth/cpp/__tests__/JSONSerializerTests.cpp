#include <iostream>
#include <cassert>
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
    
    std::cout << "JSONSerializer tests passed!" << std::endl;
    return 0;
}

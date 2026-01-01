#pragma once

#include "AuthUser.hpp"
#include <string>
#include <optional>
#include <vector>

namespace margelo::nitro::NitroAuth {

class JSONSerializer {
public:
    static std::string serialize(const AuthUser& user) {
        std::string json = "{";
        json += "\"provider\":\"" + (user.provider == AuthProvider::GOOGLE ? std::string("google") : std::string("apple")) + "\",";
        if (user.email) json += "\"email\":\"" + *user.email + "\",";
        if (user.name) json += "\"name\":\"" + *user.name + "\",";
        if (user.photo) json += "\"photo\":\"" + *user.photo + "\",";
        if (user.idToken) json += "\"idToken\":\"" + *user.idToken + "\",";
        if (user.serverAuthCode) json += "\"serverAuthCode\":\"" + *user.serverAuthCode + "\",";
        if (user.scopes) {
            json += "\"scopes\":[";
            for (size_t i = 0; i < user.scopes->size(); ++i) {
                json += "\"" + (*user.scopes)[i] + "\"";
                if (i < user.scopes->size() - 1) json += ",";
            }
            json += "],";
        }
        if (json.back() == ',') json.pop_back();
        json += "}";
        return json;
    }

    static std::optional<AuthUser> deserialize(const std::string& json) {
        if (json.find("{") == std::string::npos) return std::nullopt;
        
        AuthUser user;
        user.provider = (json.find("\"provider\":\"google\"") != std::string::npos) ? AuthProvider::GOOGLE : AuthProvider::APPLE;
        
        auto extract = [&](const std::string& key) -> std::optional<std::string> {
            std::string searchKey = "\"" + key + "\":\"";
            size_t start = json.find(searchKey);
            if (start == std::string::npos) return std::nullopt;
            start += searchKey.length();
            size_t end = json.find("\"", start);
            if (end == std::string::npos) return std::nullopt;
            return json.substr(start, end - start);
        };

        user.email = extract("email");
        user.name = extract("name");
        user.photo = extract("photo");
        user.idToken = extract("idToken");
        user.serverAuthCode = extract("serverAuthCode");
        
        return user;
    }
};

} // namespace margelo::nitro::NitroAuth

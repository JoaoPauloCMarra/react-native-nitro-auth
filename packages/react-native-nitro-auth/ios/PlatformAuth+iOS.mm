#import <Foundation/Foundation.h>
#import <NitroModules/Promise.hpp>
#import "AuthUser.hpp"
#import "AuthProvider.hpp"
#import "AuthTokens.hpp"
#import "PlatformAuth.hpp"

#if __has_include(<react_native_nitro_auth/react_native_nitro_auth-Swift.h>)
#import <react_native_nitro_auth/react_native_nitro_auth-Swift.h>
#elif __has_include("react_native_nitro_auth-Swift.h")
#import "react_native_nitro_auth-Swift.h"
#endif

#include "LoginOptions.hpp"

namespace margelo::nitro::NitroAuth {

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
    auto promise = Promise<AuthUser>::create();
    NSString* providerStr = provider == AuthProvider::GOOGLE ? @"google" : @"apple";
    
    NSMutableArray* scopesArray = [NSMutableArray array];
    NSString* hintStr = nil;
    
    if (options.has_value()) {
        if (options->scopes.has_value()) {
            for (const auto& scope : *options->scopes) {
                [scopesArray addObject:[NSString stringWithUTF8String:scope.c_str()]];
            }
        }
        if (options->loginHint.has_value()) {
            hintStr = [NSString stringWithUTF8String:options->loginHint->c_str()];
        }
    }
    
    // Default scopes if none provided
    if (scopesArray.count == 0) {
        [scopesArray addObjectsFromArray:@[@"openid", @"email", @"profile"]];
    }
    
    [AuthAdapter loginWithProvider:providerStr scopes:scopesArray loginHint:hintStr completion:^(NSDictionary* _Nullable data, NSString* _Nullable error) {
        if (error != nil) {
            promise->reject(std::make_exception_ptr(std::runtime_error([error UTF8String])));
            return;
        }
        if (data == nil) {
            promise->reject(std::make_exception_ptr(std::runtime_error("Login cancelled or failed")));
            return;
        }
        
        AuthUser user;
        user.provider = provider;
        user.email = std::string([[data objectForKey:@"email"] UTF8String]);
        user.name = std::string([[data objectForKey:@"name"] UTF8String]);
        user.photo = std::string([[data objectForKey:@"photo"] UTF8String]);
        user.idToken = std::string([[data objectForKey:@"idToken"] UTF8String]);
        if ([data objectForKey:@"accessToken"]) user.accessToken = std::string([[data objectForKey:@"accessToken"] UTF8String]);
        if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = std::string([[data objectForKey:@"serverAuthCode"] UTF8String]);
        if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        
        promise->resolve(user);
    }];
    return promise;
}

std::shared_ptr<Promise<AuthUser>> PlatformAuth::requestScopes(const std::vector<std::string>& scopes) {
    auto promise = Promise<AuthUser>::create();
    NSMutableArray* scopesArray = [NSMutableArray arrayWithCapacity:scopes.size()];
    for (const auto& scope : scopes) [scopesArray addObject:[NSString stringWithUTF8String:scope.c_str()]];
    
    [AuthAdapter addScopesWithScopes:scopesArray completion:^(NSDictionary* _Nullable data, NSString* _Nullable error) {
        if (error != nil) {
            promise->reject(std::make_exception_ptr(std::runtime_error([error UTF8String])));
            return;
        }
        if (data == nil) {
            promise->reject(std::make_exception_ptr(std::runtime_error("Request scopes failed")));
            return;
        }
        
        AuthUser user;
        user.provider = AuthProvider::GOOGLE;
        user.email = std::string([[data objectForKey:@"email"] UTF8String]);
        user.name = std::string([[data objectForKey:@"name"] UTF8String]);
        user.photo = std::string([[data objectForKey:@"photo"] UTF8String]);
        user.idToken = std::string([[data objectForKey:@"idToken"] UTF8String]);
        if ([data objectForKey:@"accessToken"]) user.accessToken = std::string([[data objectForKey:@"accessToken"] UTF8String]);
        if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = std::string([[data objectForKey:@"serverAuthCode"] UTF8String]);
        if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        promise->resolve(user);
    }];
    return promise;
}

std::shared_ptr<Promise<AuthTokens>> PlatformAuth::refreshToken() {
    auto promise = Promise<AuthTokens>::create();
    [AuthAdapter refreshTokenWithCompletion:^(NSDictionary* _Nullable data, NSString* _Nullable error) {
        if (error != nil) {
            promise->reject(std::make_exception_ptr(std::runtime_error([error UTF8String])));
            return;
        }
        AuthTokens tokens;
        if ([data objectForKey:@"accessToken"]) tokens.accessToken = std::string([[data objectForKey:@"accessToken"] UTF8String]);
        if ([data objectForKey:@"idToken"]) tokens.idToken = std::string([[data objectForKey:@"idToken"] UTF8String]);
        if ([data objectForKey:@"expirationTime"]) tokens.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        promise->resolve(tokens);
    }];
    return promise;
}

std::shared_ptr<Promise<std::optional<AuthUser>>> PlatformAuth::silentRestore() {
    auto promise = Promise<std::optional<AuthUser>>::create();
    [AuthAdapter initializeWithCompletion:^(NSDictionary* _Nullable data) {
        if (data == nil) {
            promise->resolve(std::nullopt);
            return;
        }
        AuthUser user;
        user.provider = [[data objectForKey:@"provider"] isEqualToString:@"google"] ? AuthProvider::GOOGLE : AuthProvider::APPLE;
        user.email = std::string([[data objectForKey:@"email"] UTF8String]);
        user.name = std::string([[data objectForKey:@"name"] UTF8String]);
        user.photo = std::string([[data objectForKey:@"photo"] UTF8String]);
        user.idToken = std::string([[data objectForKey:@"idToken"] UTF8String]);
        if ([data objectForKey:@"accessToken"]) user.accessToken = std::string([[data objectForKey:@"accessToken"] UTF8String]);
        if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = std::string([[data objectForKey:@"serverAuthCode"] UTF8String]);
        if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        promise->resolve(user);
    }];
    return promise;
}

bool PlatformAuth::hasPlayServices() {
    return true;
}

void PlatformAuth::logout() {
    [AuthAdapter logout];
}

} // namespace margelo::nitro::NitroAuth

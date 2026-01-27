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
 
 inline std::string nsToStd(NSString* _Nullable ns) {
     if (ns == nil) return "";
     return std::string([ns UTF8String]);
 }

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
    
    BOOL useSheet = NO;
    if (options.has_value() && options->useSheet.has_value()) {
        useSheet = options->useSheet.value();
    }
    
    [AuthAdapter loginWithProvider:providerStr scopes:scopesArray loginHint:hintStr useSheet:useSheet completion:^(NSDictionary* _Nullable data, NSString* _Nullable error) {
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
        user.email = nsToStd([data objectForKey:@"email"]);
        user.name = nsToStd([data objectForKey:@"name"]);
        user.photo = nsToStd([data objectForKey:@"photo"]);
        user.idToken = nsToStd([data objectForKey:@"idToken"]);
        if ([data objectForKey:@"accessToken"]) user.accessToken = nsToStd([data objectForKey:@"accessToken"]);
        if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = nsToStd([data objectForKey:@"serverAuthCode"]);
        if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        if ([data objectForKey:@"underlyingError"]) user.underlyingError = nsToStd([data objectForKey:@"underlyingError"]);
        
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
        user.email = nsToStd([data objectForKey:@"email"]);
        user.name = nsToStd([data objectForKey:@"name"]);
        user.photo = nsToStd([data objectForKey:@"photo"]);
        user.idToken = nsToStd([data objectForKey:@"idToken"]);
        if ([data objectForKey:@"accessToken"]) user.accessToken = nsToStd([data objectForKey:@"accessToken"]);
        if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = nsToStd([data objectForKey:@"serverAuthCode"]);
        if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        if ([data objectForKey:@"underlyingError"]) user.underlyingError = nsToStd([data objectForKey:@"underlyingError"]);
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
        if ([data objectForKey:@"accessToken"]) tokens.accessToken = nsToStd([data objectForKey:@"accessToken"]);
        if ([data objectForKey:@"idToken"]) tokens.idToken = nsToStd([data objectForKey:@"idToken"]);
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
        user.email = nsToStd([data objectForKey:@"email"]);
        user.name = nsToStd([data objectForKey:@"name"]);
        user.photo = nsToStd([data objectForKey:@"photo"]);
        user.idToken = nsToStd([data objectForKey:@"idToken"]);
        if ([data objectForKey:@"accessToken"]) user.accessToken = nsToStd([data objectForKey:@"accessToken"]);
        if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = nsToStd([data objectForKey:@"serverAuthCode"]);
        if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
        if ([data objectForKey:@"underlyingError"]) user.underlyingError = nsToStd([data objectForKey:@"underlyingError"]);
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

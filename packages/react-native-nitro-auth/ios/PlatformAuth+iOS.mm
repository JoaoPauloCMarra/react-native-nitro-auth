#import <Foundation/Foundation.h>
#import <NitroModules/Promise.hpp>
#import "AuthUser.hpp"
#import "AuthProvider.hpp"
#import "AuthTokens.hpp"
#import "AuthError.hpp"
#import "PlatformAuth.hpp"

#if __has_include(<react_native_nitro_auth/react_native_nitro_auth-Swift.h>)
#import <react_native_nitro_auth/react_native_nitro_auth-Swift.h>
#elif __has_include("react_native_nitro_auth-Swift.h")
#import "react_native_nitro_auth-Swift.h"
#endif

#include "LoginOptions.hpp"
#include "MicrosoftPrompt.hpp"
#include <cstdint>
#include <mutex>
#include <stdexcept>

namespace margelo::nitro::NitroAuth {

namespace {

std::mutex gRevokeMutex;
std::shared_ptr<Promise<void>> gRevokePromise;
uint64_t gRevokeGeneration = 0;
uint64_t gGenerationCounter = 0;

uint64_t nextGeneration() {
    ++gGenerationCounter;
    if (gGenerationCounter == 0) {
        ++gGenerationCounter;
    }
    return gGenerationCounter;
}

} // namespace
 
 inline std::optional<std::string> nsToStd(NSString* _Nullable ns) {
     if (ns == nil) return std::nullopt;
     std::string value([ns UTF8String]);
     if (value.empty()) return std::nullopt;
     return value;
 }

 inline std::optional<std::vector<std::string>> nsArrayToStd(NSArray<NSString*>* _Nullable nsArray) {
     if (nsArray == nil || nsArray.count == 0) return std::nullopt;

     std::vector<std::string> values;
     values.reserve(nsArray.count);
     for (NSString* value in nsArray) {
         if (value.length == 0) continue;
         values.emplace_back([value UTF8String]);
     }

     if (values.empty()) return std::nullopt;
     return values;
 }

 inline std::optional<AuthProvider> authProviderFromString(NSString* _Nullable providerStr) {
     if ([providerStr isEqualToString:@"google"]) return AuthProvider::GOOGLE;
     if ([providerStr isEqualToString:@"microsoft"]) return AuthProvider::MICROSOFT;
     if ([providerStr isEqualToString:@"apple"]) return AuthProvider::APPLE;
     return std::nullopt;
 }

 inline AuthUser userFromNSDictionary(NSDictionary* data, AuthProvider provider) {
     AuthUser user;
     user.provider = provider;
     user.email = nsToStd([data objectForKey:@"email"]);
     user.name = nsToStd([data objectForKey:@"name"]);
     user.photo = nsToStd([data objectForKey:@"photo"]);
     user.idToken = nsToStd([data objectForKey:@"idToken"]);
     if ([data objectForKey:@"accessToken"]) user.accessToken = nsToStd([data objectForKey:@"accessToken"]);
     if ([data objectForKey:@"serverAuthCode"]) user.serverAuthCode = nsToStd([data objectForKey:@"serverAuthCode"]);
     if ([data objectForKey:@"authorizationCode"]) user.authorizationCode = nsToStd([data objectForKey:@"authorizationCode"]);
     if ([data objectForKey:@"userId"]) user.userId = nsToStd([data objectForKey:@"userId"]);
     if ([data objectForKey:@"phoneNumber"]) user.phoneNumber = nsToStd([data objectForKey:@"phoneNumber"]);
     if ([data objectForKey:@"hostedDomain"]) user.hostedDomain = nsToStd([data objectForKey:@"hostedDomain"]);
     if ([data objectForKey:@"scopes"]) user.scopes = nsArrayToStd([data objectForKey:@"scopes"]);
     if ([data objectForKey:@"expirationTime"]) user.expirationTime = [[data objectForKey:@"expirationTime"] doubleValue];
     if ([data objectForKey:@"underlyingError"]) user.underlyingError = nsToStd([data objectForKey:@"underlyingError"]);
     return user;
 }

std::shared_ptr<Promise<AuthUser>> PlatformAuth::login(AuthProvider provider, const std::optional<LoginOptions>& options) {
    auto promise = Promise<AuthUser>::create();
    NSString* providerStr;
    switch (provider) {
        case AuthProvider::GOOGLE: providerStr = @"google"; break;
        case AuthProvider::APPLE: providerStr = @"apple"; break;
        case AuthProvider::MICROSOFT: providerStr = @"microsoft"; break;
    }
    
    NSMutableArray* scopesArray = [NSMutableArray array];
    NSString* hintStr = nil;
    NSString* nonceStr = nil;
    NSString* tenantStr = nil;
    NSString* promptStr = nil;
    NSString* hostedDomainStr = nil;
    NSString* openIDRealmStr = nil;
    
    if (options.has_value()) {
        if (options->scopes.has_value()) {
            for (const auto& scope : *options->scopes) {
                [scopesArray addObject:[NSString stringWithUTF8String:scope.c_str()]];
            }
        }
        if (options->loginHint.has_value()) {
            hintStr = [NSString stringWithUTF8String:options->loginHint->c_str()];
        }
        if (options->nonce.has_value()) {
            nonceStr = [NSString stringWithUTF8String:options->nonce->c_str()];
        }
        if (options->tenant.has_value()) {
            tenantStr = [NSString stringWithUTF8String:options->tenant->c_str()];
        }
        if (options->hostedDomain.has_value()) {
            hostedDomainStr = [NSString stringWithUTF8String:options->hostedDomain->c_str()];
        }
        if (options->openIDRealm.has_value()) {
            openIDRealmStr = [NSString stringWithUTF8String:options->openIDRealm->c_str()];
        }
        if (options->prompt.has_value()) {
            switch (options->prompt.value()) {
                case MicrosoftPrompt::LOGIN: promptStr = @"login"; break;
                case MicrosoftPrompt::CONSENT: promptStr = @"consent"; break;
                case MicrosoftPrompt::SELECT_ACCOUNT: promptStr = @"select_account"; break;
                case MicrosoftPrompt::NONE: promptStr = @"none"; break;
            }
        }
    }
    
    BOOL useSheet = NO;
    if (options.has_value() && options->useSheet.has_value()) {
        useSheet = options->useSheet.value();
    }
    
    BOOL forceAccountPicker = NO;
    if (options.has_value() && options->forceAccountPicker.has_value()) {
        forceAccountPicker = options->forceAccountPicker.value();
    }
    
    [AuthAdapter loginWithProvider:providerStr scopes:scopesArray loginHint:hintStr nonce:nonceStr useSheet:useSheet forceAccountPicker:forceAccountPicker tenant:tenantStr prompt:promptStr hostedDomain:hostedDomainStr openIDRealm:openIDRealmStr completion:^(NSDictionary* _Nullable data, NSNumber* _Nullable code, NSString* _Nullable message) {
        if (code != nil) {
            promise->reject(makeAuthError(authErrorCodeFromInt((int)code.integerValue), nsToStd(message)));
            return;
        }
        if (data == nil) {
            promise->reject(std::make_exception_ptr(AuthException(AuthErrorCode::UNKNOWN, "Login cancelled or failed")));
            return;
        }

        AuthUser user = userFromNSDictionary(data, provider);
        promise->resolve(user);
    }];
    return promise;
}

std::shared_ptr<Promise<AuthUser>> PlatformAuth::requestScopes(const std::vector<std::string>& scopes) {
    auto promise = Promise<AuthUser>::create();
    NSMutableArray* scopesArray = [NSMutableArray arrayWithCapacity:scopes.size()];
    for (const auto& scope : scopes) [scopesArray addObject:[NSString stringWithUTF8String:scope.c_str()]];
    
    [AuthAdapter addScopesWithScopes:scopesArray completion:^(NSDictionary* _Nullable data, NSNumber* _Nullable code, NSString* _Nullable message) {
        if (code != nil) {
            promise->reject(makeAuthError(authErrorCodeFromInt((int)code.integerValue), nsToStd(message)));
            return;
        }
        if (data == nil) {
            promise->reject(std::make_exception_ptr(AuthException(AuthErrorCode::UNKNOWN, "Request scopes failed")));
            return;
        }

        std::optional<AuthProvider> provider = authProviderFromString([data objectForKey:@"provider"]);
        if (!provider.has_value()) {
            promise->reject(makeAuthError(AuthErrorCode::UNSUPPORTED_PROVIDER));
            return;
        }
        AuthUser user = userFromNSDictionary(data, provider.value());
        promise->resolve(user);
    }];
    return promise;
}

std::shared_ptr<Promise<AuthTokens>> PlatformAuth::refreshToken() {
    auto promise = Promise<AuthTokens>::create();
    [AuthAdapter refreshTokenWithCompletion:^(NSDictionary* _Nullable data, NSNumber* _Nullable code, NSString* _Nullable message) {
        if (code != nil) {
            promise->reject(makeAuthError(authErrorCodeFromInt((int)code.integerValue), nsToStd(message)));
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
    [AuthAdapter initializeWithCompletion:^(NSDictionary* _Nullable data, NSNumber* _Nullable code, NSString* _Nullable message) {
        if (code != nil) {
            if (code.integerValue == static_cast<NSInteger>(AuthErrorCode::NOT_SIGNED_IN)) {
                promise->resolve(std::nullopt);
            } else {
                promise->reject(makeAuthError(authErrorCodeFromInt((int)code.integerValue), nsToStd(message)));
            }
            return;
        }
        if (data == nil) {
            promise->reject(makeAuthError(AuthErrorCode::UNKNOWN));
            return;
        }
        std::optional<AuthProvider> provider = authProviderFromString([data objectForKey:@"provider"]);
        if (!provider.has_value()) {
            promise->reject(makeAuthError(AuthErrorCode::UNSUPPORTED_PROVIDER));
            return;
        }
        AuthUser user = userFromNSDictionary(data, provider.value());
        promise->resolve(user);
    }];
    return promise;
}

bool PlatformAuth::hasPlayServices() {
    return true;
}

void PlatformAuth::invalidatePendingOperations() {
    [AuthAdapter cancelPendingOperations];
}

void PlatformAuth::cancelPendingOperations(AuthErrorCode reason) {
    std::shared_ptr<Promise<void>> revokePromise;
    {
        std::lock_guard<std::mutex> lock(gRevokeMutex);
        revokePromise = std::move(gRevokePromise);
        gRevokeGeneration = nextGeneration();
    }
    if (revokePromise) {
        revokePromise->reject(makeAuthError(reason));
    }
    [AuthAdapter cancelPendingOperations];
}

void PlatformAuth::logout() {
    [AuthAdapter logout];
}

std::shared_ptr<Promise<void>> PlatformAuth::revokeAccess(AuthProvider provider) {
    auto promise = Promise<void>::create();
    uint64_t generation;
    {
        std::lock_guard<std::mutex> lock(gRevokeMutex);
        if (gRevokePromise) {
            promise->reject(makeAuthError(AuthErrorCode::OPERATION_IN_PROGRESS));
            return promise;
        }
        generation = nextGeneration();
        gRevokeGeneration = generation;
        gRevokePromise = promise;
    }
    NSString* providerName;
    switch (provider) {
        case AuthProvider::GOOGLE:
            providerName = @"google";
            break;
        case AuthProvider::APPLE:
            providerName = @"apple";
            break;
        case AuthProvider::MICROSOFT:
            providerName = @"microsoft";
            break;
    }
    [AuthAdapter revokeAccessWithProvider:providerName completion:^(NSNumber* _Nullable code, NSString* _Nullable message) {
        std::shared_ptr<Promise<void>> revokePromise;
        {
            std::lock_guard<std::mutex> lock(gRevokeMutex);
            if (gRevokePromise && gRevokeGeneration == generation) {
                revokePromise = std::move(gRevokePromise);
            }
        }
        if (!revokePromise) {
            return;
        }
        if (code != nil) {
            revokePromise->reject(makeAuthError(authErrorCodeFromInt((int)code.integerValue), nsToStd(message)));
            return;
        }
        revokePromise->resolve();
    }];
    return promise;
}

} // namespace margelo::nitro::NitroAuth

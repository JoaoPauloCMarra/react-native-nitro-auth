# Changelog

## 0.6.5 - 2026-06-11

### Fixed

- Moved the Expo iOS Google Sign-In CocoaPods modular-header setup into the package config plugin so Expo/CNG consumers no longer need app-level `AppCheckCore`, `GoogleUtilities`, or `RecaptchaInterop` pod workarounds.
- Added the package plugin dependency needed to apply the iOS build-properties setup from the package.

## 0.6.4 - 2026-06-11

### Added

- Added a modern `exports` map with `react-native`, `browser`, `import`, and `require` conditions plus explicit `./app.plugin`, `./app.plugin.js`, and `./package.json` subpaths, so bundlers and Node resolve the package deterministically.

### Changed

- Strengthened the package TypeScript configuration (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`) so editor and tooling diagnostics catch more mistakes at compile time.

### Fixed

- Encoded iOS Microsoft token request bodies as form data so authorization codes, redirect URIs, and refresh tokens containing reserved characters are posted correctly.

## 0.6.3 - 2026-06-10

### Fixed

- Hardened Microsoft authority URL construction to reject absolute tenant URLs and invalid B2C domains while building valid B2C tenant/policy authority paths.

### Changed

- Updated README setup, provider examples, option tables, error codes, and typed API documentation to match the current package surface.
- Added stronger compile-time coverage for provider-specific login options used by `AuthService.login()` and `useAuth().login()`.

## 0.6.1 - 2026-05-21

### Changed

- Updated the package baseline to Expo SDK 56, React Native 0.85.3, React 19.2.3, TypeScript 6.0.3, Nitro Modules 0.35.7, and nitrogen 0.35.7.
- Raised the iOS deployment target to 16.4 for SDK 56 compatibility.
- Added compile-time coverage for provider-specific login option types.

### Fixed

- Retained the active iOS Apple Sign-In controller until completion to avoid premature native lifecycle cleanup.

## 0.6.0 - 2026-05-14

### Added

- Added provider option support for Google nonce, hosted domain, OpenID realm, authorized-account filtering, verified phone number requests, refresh-code forcing, and Android legacy Google sign-in.
- Added Apple nonce and authorization-code/user-id result support.
- Added Microsoft tenant and prompt option coverage across native and web flows.
- Added `revokeAccess()` to the native/web auth API and `useAuth()` hook.
- Added native logging hooks.
- Added provider-specific TypeScript option types for `AuthService.login()` and `useAuth().login()`.

### Changed

- Updated Nitro Modules and native SDK dependencies, including Android Credential Manager, Activity, Browser, and API 36 targets.
- Hardened native and web promise handling so stale sign-in, scope, restore, revoke, and token operations settle consistently.
- Updated Android Google sign-out to avoid noisy Credential Manager cleanup during normal logout while preserving deep cleanup through revoke access.

### Fixed

- Fixed Android Google cancellation handling so cancellations are not reported as unknown failures.
- Fixed native session cleanup paths to reject pending work before clearing provider state.

## 0.5.12 - 2026-05-13

### Fixed

- Normalized web `SocialButton` and native login failures so presentation-anchor and missing-code errors surface as stable `AuthError` codes.
- Shipped package-level Watchman ignores for Android CMake cache output so consumers avoid noisy native build watcher events.

## 0.5.11 - 2026-05-05

### Fixed

- Wrapped synchronous native service failures in `AuthError` so public service errors keep a consistent code contract.

## 0.5.10 - 2026-04-27

### Fixed

- Fixed iOS Microsoft sign-in so `ASWebAuthenticationSession` is retained until callback or cancellation and duplicate sessions fail with `operation_in_progress`.

## 0.5.9 - 2026-04-24

### Changed

- Updated Expo SDK 55 patch dependencies, React Native 0.83.6, and Nitro Modules 0.35.5.
- Refactored native/web `AuthService` creation so native and web error mapping stay consistent.
- Hardened web OAuth state, cache parsing, token refresh, and provider error handling.

### Fixed

- Excluded C++ test sources from the iOS pod target to avoid app-target duplicate `main` symbols.

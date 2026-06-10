# Changelog

## 0.6.2 - 2026-06-10

### Fixed

- Hardened Microsoft authority URL construction to reject absolute tenant URLs and invalid B2C domains while building valid B2C tenant/policy authority paths.
- Kept the Expo example iOS build on source-built Expo modules until precompiled module linking is supported by the current native dependency set.

### Changed

- Updated the Expo example SDK 56 patch dependencies so Expo Doctor passes cleanly.
- Polished the Expo example app UI for more consistent provider cards, controls, smoke-test status, and action states.
- Reduced unnecessary example-app React work by memoizing repeated demo rows, smoke-test UI, social buttons, and stable action handlers.
- Updated README setup, provider examples, option tables, badge links, error codes, and typed API documentation to match the current package surface.
- Added stronger compile-time coverage for provider-specific login options used by `AuthService.login()` and `useAuth().login()`.

## 0.6.1 - 2026-05-21

### Changed

- Updated the package and Expo example baseline to Expo SDK 56, React Native 0.85.3, React 19.2.3, TypeScript 6.0.3, Nitro Modules 0.35.7, and nitrogen 0.35.7.
- Raised the iOS deployment target to 16.4 for SDK 56 compatibility.
- Added release preflight checks for Expo dependency validation, Expo Doctor, config introspection, package build, tests, C++ tests, and publish dry run.
- Simplified the example app by keeping provider-specific advanced options collapsed by default.
- Updated README badges, setup commands, release checks, and typed API examples to match the 0.6.1 package state.
- Added compile-time coverage for provider-specific login option types.
- Added CI setup and versioned tool detection for LLVM C++ coverage tools.
- Added a CI-safe release preflight mode that skips unauthenticated npm publish dry runs while keeping local publish dry runs intact.

### Fixed

- Retained the active iOS Apple Sign-In controller until completion to avoid premature native lifecycle cleanup.
- Removed the example app's import-time native logging side effect.
- Removed Turbo cache-output warnings from lint and typecheck tasks.

## 0.6.0 - 2026-05-14

### Added

- Added provider option support for Google nonce, hosted domain, OpenID realm, authorized-account filtering, verified phone number requests, refresh-code forcing, and Android legacy Google sign-in.
- Added Apple nonce and authorization-code/user-id result support.
- Added Microsoft tenant and prompt option coverage across native and web flows.
- Added `revokeAccess()` to the native/web auth API and `useAuth()` hook.
- Added native logging hooks and platform-gated example controls for supported provider options only.
- Added provider-specific TypeScript option types for `AuthService.login()` and `useAuth().login()`.

### Changed

- Updated Nitro Modules and native SDK dependencies, including Android Credential Manager, Activity, Browser, and API 36 targets.
- Hardened native and web promise handling so stale sign-in, scope, restore, revoke, and token operations settle consistently.
- Updated Android Google sign-out to avoid noisy Credential Manager cleanup during normal logout while preserving deep cleanup through revoke access.

### Fixed

- Fixed Android Metro watcher noise from transient Bun `node_modules/.old-*` directories in the example app.
- Fixed Android Google cancellation handling so cancellations are not reported as unknown failures.
- Fixed native session cleanup paths to reject pending work before clearing provider state.

## 0.5.12 - 2026-05-13

### Changed

- Updated the Expo example to the current SDK 55 recommended `expo`, `expo-build-properties`, and `expo-system-ui` patch ranges.

### Fixed

- Fixed the Android example launcher icon by adding an adaptive icon foreground and dark brand background.
- Normalized web `SocialButton` and native login failures so presentation-anchor and missing-code errors surface as stable `AuthError` codes.
- Shipped package-level Watchman ignores for Android CMake cache output so consumers avoid noisy native build watcher events.

## 0.5.11 - 2026-05-05

### Changed

- Updated the Expo example to the Expo SDK 55 recommended `expo@~55.0.23` patch and Android API 36 target.

### Fixed

- Wrapped synchronous native service failures in `AuthError` so public service errors keep a consistent code contract.

### Verified

- `bun install --frozen-lockfile`
- `bunx expo install --check --cwd apps/example`
- `bunx expo-doctor@latest apps/example`
- `bun run check:ci`
- `bun run --cwd packages/react-native-nitro-auth test:coverage -- --runInBand`
- `bun run --cwd packages/react-native-nitro-auth test:cpp:coverage`
- `bun run example:prebuild`
- `bun run publish-package:dry-run`

## 0.5.10 - 2026-04-27

### Fixed

- Fixed iOS Microsoft sign-in so `ASWebAuthenticationSession` is retained until callback or cancellation and duplicate sessions fail with `operation_in_progress`.
- Fixed the example app header so it displays the current package version.

### Verified

- `bun run check:ci`
- `bunx expo install --check --cwd apps/example`
- `bunx expo-doctor@latest apps/example`
- `bun run example:prebuild`
- `bun run publish-package:dry-run`

## 0.5.9 - 2026-04-24

### Added

- Added shared JS service factory coverage and logger behavior tests.
- Added C++ coverage support with `test:cpp:coverage` and expanded native tests for session restore, token refresh, access-token fallback, scope updates, listener isolation, logout cancellation, and serializer behavior.
- Added example-app smoke checks for the public auth API, provider support, platform-gated behavior, and session-dependent methods.

### Changed

- Updated Expo SDK 55 patch dependencies, React Native 0.83.6, Nitro Modules 0.35.5, and related build tooling.
- Refactored native/web `AuthService` creation so native and web error mapping stay consistent.
- Hardened web OAuth state, cache parsing, token refresh, and provider error handling.
- Improved example app handling for unsupported providers and unavailable session actions.
- Improved release validation to include JS and C++ coverage gates and a faster publish dry run path.

### Fixed

- Fixed native runtime crashes in the example app when optional Nitro methods are not available on the installed native object.
- Fixed startup `silentRestore()` errors in the example app so restore failures surface in status instead of becoming unhandled promises.
- Excluded C++ test sources from the iOS pod target to avoid app-target duplicate `main` symbols.

### Verified

- `bun run check:ci`
- `bun run --cwd packages/react-native-nitro-auth test:coverage -- --runInBand`
- `bun run --cwd packages/react-native-nitro-auth test:cpp:coverage`
- `bun run publish-package:dry-run`
- `bun run example:prebuild`
- `bun run example:android`
- `bun run example:ios`

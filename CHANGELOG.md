# Changelog

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

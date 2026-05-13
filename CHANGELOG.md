# Changelog

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

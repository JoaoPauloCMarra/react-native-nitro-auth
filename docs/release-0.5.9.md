# react-native-nitro-auth 0.5.9

## PR Description

### Summary

Prepares `react-native-nitro-auth@0.5.9` with dependency updates, native/web auth hardening, stronger package coverage, an example-app smoke-test surface, and a faster publish validation path.

### Changes

- Update Expo SDK 55 patch dependencies, React Native 0.83.6, Nitro Modules 0.35.5, and related tooling.
- Refactor `AuthService` construction for shared native/web error mapping and runtime-safe optional native methods.
- Harden web OAuth cache parsing, state handling, token refresh, and provider error mapping.
- Add JS and C++ coverage gates, expanded C++ tests, and package coverage thresholds.
- Add example-app smoke tests and disabled states for unsupported platform/session actions.
- Improve `scripts/publish.js` with timed release phases, coverage checks, docs sync, pack validation, and `bun publish --ignore-scripts` to avoid duplicated lifecycle work.
- Add `CHANGELOG.md` and sync it into the package.

### Test

- `bun run typecheck`
- `bun run --cwd packages/react-native-nitro-auth test -- --runInBand`
- `bun run --cwd packages/react-native-nitro-auth test:coverage -- --runInBand`
- `bun run --cwd packages/react-native-nitro-auth test:cpp:coverage`
- `bun run check:ci`
- `bun run publish-package:dry-run`
- `bun run example:prebuild`
- `bun run example:android`
- `bun run example:ios`

## Release Description

`react-native-nitro-auth@0.5.9` focuses on release readiness and runtime hardening. It updates the Expo/RN/Nitro dependency baseline, improves native and web auth service consistency, expands C++ and JS test coverage, and adds example-app smoke checks for every public auth method and platform support state.

The release also improves publishing reliability: the dry-run flow now runs coverage gates, Expo Doctor, package docs sync, pack validation, and `bun publish --dry-run --ignore-scripts` so publish validation avoids duplicated lifecycle work while still proving the package is deployable.

### Highlights

- Expo SDK 55 patch baseline with React Native 0.83.6 and Nitro Modules 0.35.5.
- Shared `AuthService` factory with consistent `AuthError` mapping.
- Web OAuth hardening for state, cache parsing, token refresh, and provider errors.
- JS coverage above 98% statements and C++ coverage above 94% lines.
- Example app smoke tests and disabled unsupported actions/providers.
- Faster, timed publish dry run with README/CHANGELOG sync and pack validation.

### Validation

- Package checks, build, JS tests, C++ tests, JS coverage, C++ coverage, Expo Doctor, pack dry run, and publish dry run passed.
- Example app prebuild, Android launch, and iOS launch passed.

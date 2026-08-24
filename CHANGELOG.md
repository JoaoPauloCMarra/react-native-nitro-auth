# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes are always listed first in each release section.

## [0.10.0] - 2026-08-24

### Breaking changes

- None.

### Fixed

- Android: a completed `msauth://` Microsoft redirect no longer reports
  `cancelled` (and no longer clears PKCE state before the token exchange
  finishes). The redirect handler resuming no longer cancels the flow.
- Android: an abandoned interactive Google sign-in (sign-in activity finished
  without a result) now rejects with `cancelled` instead of leaving the login
  promise pending and rejecting later logins with `operation_in_progress`.
  The sign-in activity no longer relaunches the Google flow after a
  configuration change.
- Android: cancelling the One-Tap (Credential Manager) sheet now resolves the
  login with `cancelled` instead of silently launching the legacy sign-in
  activity.

### Changed

- `requestScopes` now succeeds for one-tap-only Google sessions on Android and
  resolves with the session user plus the merged scope list, matching iOS.
  Previously it rejected with `not_signed_in`.
- `revokeAccess()` with no active Google session rejects with `not_signed_in` on
  Android. Active Credential Manager/One-Tap sessions are not eligible for
  client-side provider revocation and reject with `unsupported_provider`; local
  session state is unchanged.
- iOS now populates `AuthError.underlyingMessage`: native rejections use the
  same `<code>: <detail>` envelope as Android and web.
- The returned user's `hostedDomain` now reports the requested configuration
  value on Android, matching iOS; it is never derived from the account email.
- Unknown provider strings from platform callbacks now reject with
  `unsupported_provider` instead of defaulting to Apple (iOS silent restore,
  Android login callbacks).
- `SocialButton.onError` preserves the 0.9.x `(error: AuthError) => void`
  callback type; runtime failures are normalized to `AuthError` before the
  callback.

## [0.9.0] - 2026-08-20

### Breaking changes

- The `react-native-nitro-modules` peer dependency is now
  `>=0.37.0 <0.38.0`. Consumers using Nitro Modules 0.36.x must upgrade before
  installing this release.

### Changed

- Added a React Native 0.87.0 Strict TypeScript compatibility check while
  retaining React Native 0.86.2 for the package gate and Expo SDK 57 example.
- `SocialButtonProps.onError` now exposes the normalized `AuthError` contract.

## [0.8.0] - 2026-08-13

### Breaking changes

- None.

### Added

- `AuthService.loginAndGetUser()` runs the existing `login()` native call and
  returns `currentUser`, or rejects with `not_signed_in` when login succeeds
  without a session. `login()` remains `Promise<void>`.
- The Expo plugin derives `ios.googleUrlScheme` from `ios.googleClientId` when
  the scheme is omitted. An explicit `ios.googleUrlScheme` still wins.

### Changed

- Documented that `logout()` is synchronous `void`.

## [0.7.0] - 2026-08-12

### Breaking changes

- `AuthErrorCode` adds `interaction_required`. Exhaustive switches over this
  union must handle the new case. This is retained because it distinguishes a
  required interactive login from configuration, network, and token failures.

### Added

- Added the `interaction_required` error code for silent-restore and OAuth
  `interaction_required`/`login_required`/`consent_required` responses.
- Added typed provider token capabilities
  (`getProviderTokenCapabilities`, `ProviderTokenCapabilities`) documenting
  per-platform access-token, refresh, server-auth-code, and expiry-source
  support, including the Android Google access-token limitation.
- Added privacy-safe typed auth lifecycle events via `onAuthEvent()`
  (`login_started`, `login_succeeded`, `login_failed`, `tokens_refreshed`,
  `refresh_failed`, `session_changed`, `logout`, `dispose`).
- Added `revokeScopesWithResult()` for the typed local-only result while
  preserving the established `Promise<void>` return from `revokeScopes()`.
- Added `nitroAuthPersistProfileOnWeb` to keep web profile PII (email, name,
  photo) out of storage, and declared `expo-constants` as an optional peer for
  the web provider-config read.

### Changed

- `AuthError` now carries the failed `operation` phase and preserves
  `underlyingMessage` from native `<code>: <detail>` envelopes; message text is
  never used as control flow.
- `expirationTime` is documented as access-token expiry on every platform, with
  the Android Google ID-token `exp` fallback made explicit.
- Web Google login now verifies redirect `state` before parsing and web popups
  are matched against the exact registered redirect target; popup polling was
  reduced from 100 ms to 500 ms.
- Web silent restore never opens interactive UI: near-expiry Google sessions
  reject with `interaction_required`.
- Existing custom web storage adapters continue to persist tokens unless
  `nitroAuthPersistTokensOnWeb: false` is explicit. New integrations should
  make this security choice explicit.
- Native dispose rejects pending work with `cancelled`, clears listeners, and
  performs platform teardown; Android populates the error envelope with the
  underlying provider message.
- Android Google sign-in error mapping now covers `operation_in_progress`,
  `not_signed_in`, and the canonical OAuth table with refresh-context
  `refresh_failed` semantics.
- OAuth provider errors now map through one canonical table on iOS, Android,
  and web; refresh operations surface grant failures as `refresh_failed`.

### Fixed

- Android Microsoft sign-in now resolves as `cancelled` when the user dismisses
  the browser, instead of leaving the login promise pending.
- The public `SocialButton` exposes its label, busy state, and disabled state to
  assistive technology, and no longer renders an unavailable Apple glyph on
  Android.
- Restored iOS compilation for Apple nonce validation by making the shared JWT
  decoder available to the file-local authorization delegate.
- Web Apple login validates the identity-token `nonce` claim; iOS validates it
  when a nonce is provided.
- Web refresh now requires an `id_token` in the token response, matching iOS.

## [0.6.6] - 2026-07-30

### Changed

- **Breaking changes:** None.
- Updated the validated compatibility baseline to Expo SDK 57, React Native 0.86.2, React 19.2.3, and Nitro Modules 0.36.4, with the Nitro Modules peer dependency bounded to `>=0.36.4 <0.37.0`.

### Fixed

- Moved the Expo iOS Google Sign-In CocoaPods modular-header setup into the package config plugin so Expo/CNG consumers no longer need app-level `AppCheckCore`, `GoogleUtilities`, or `RecaptchaInterop` pod workarounds.
- Added the package plugin dependency needed to apply the iOS build-properties setup from the package.
- Made `revokeAccess()` perform provider revocation for supported Google sessions, preserve the active session when revocation fails, and reject unsupported providers instead of degrading to logout.
- Propagated native and web silent-restore configuration and network failures while suppressing only a genuine missing session.
- Propagated Android native initialization failures as `configuration_error` and reset disposed service singletons for safe recreation.

## [0.6.4] - 2026-06-11

### Added

- Added a modern `exports` map with `react-native`, `browser`, `import`, and `require` conditions plus explicit `./app.plugin`, `./app.plugin.js`, and `./package.json` subpaths, so bundlers and Node resolve the package deterministically.

### Changed

- Strengthened the package TypeScript configuration (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`) so editor and tooling diagnostics catch more mistakes at compile time.

### Fixed

- Encoded iOS Microsoft token request bodies as form data so authorization codes, redirect URIs, and refresh tokens containing reserved characters are posted correctly.

## [0.6.3] - 2026-06-10

### Fixed

- Hardened Microsoft authority URL construction to reject absolute tenant URLs and invalid B2C domains while building valid B2C tenant/policy authority paths.

### Changed

- Updated README setup, provider examples, option tables, error codes, and typed API documentation to match the current package surface.
- Added stronger compile-time coverage for provider-specific login options used by `AuthService.login()` and `useAuth().login()`.

## [0.6.1] - 2026-05-21

### Changed

- Updated the package baseline to Expo SDK 56, React Native 0.85.3, React 19.2.3, TypeScript 6.0.3, Nitro Modules 0.35.7, and nitrogen 0.35.7.
- Raised the iOS deployment target to 16.4 for SDK 56 compatibility.
- Added compile-time coverage for provider-specific login option types.

### Fixed

- Retained the active iOS Apple Sign-In controller until completion to avoid premature native lifecycle cleanup.

## [0.6.0] - 2026-05-14

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

## [0.5.12] - 2026-05-13

### Fixed

- Normalized web `SocialButton` and native login failures so presentation-anchor and missing-code errors surface as stable `AuthError` codes.
- Shipped package-level Watchman ignores for Android CMake cache output so consumers avoid noisy native build watcher events.

## [0.5.11] - 2026-05-05

### Fixed

- Wrapped synchronous native service failures in `AuthError` so public service errors keep a consistent code contract.

## [0.5.10] - 2026-04-27

### Fixed

- Fixed iOS Microsoft sign-in so `ASWebAuthenticationSession` is retained until callback or cancellation and duplicate sessions fail with `operation_in_progress`.

## [0.5.9] - 2026-04-24

### Changed

- Updated Expo SDK 55 patch dependencies, React Native 0.83.6, and Nitro Modules 0.35.5.
- Refactored native/web `AuthService` creation so native and web error mapping stay consistent.
- Hardened web OAuth state, cache parsing, token refresh, and provider error handling.

### Fixed

- Excluded C++ test sources from the iOS pod target to avoid app-target duplicate `main` symbols.

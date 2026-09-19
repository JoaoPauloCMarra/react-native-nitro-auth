# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes are always listed first in each release section.

## [0.11.1] - 2026-09-18

### Breaking changes

- None.

### Added

- Hidden example credentials lab at `auth://e2e-credentials` for nonce,
  capability, and snapshot coverage without live OAuth.

### Changed

- The example Expo pin follows SDK 57.0.24 (`expo-doctor` / `expo install --check`).
  React Native stays `0.86.3`.
- The example iOS host uses a `SceneDelegate` so the app can present a window on
  iOS 27 physical devices.
- The example leaves `ios.appleSignIn` off unless `NITRO_AUTH_APPLE_SIGN_IN=1`,
  so a free personal team can install on a physical iPhone. Live Apple Sign-In
  still needs a paid Apple Developer team.
- Native nonce hashing and JWT payload splits share `cpp/AuthCrypto.cpp`
  (SHA-256 hex + base64url). Signatures are still not verified. See
  [docs/native-libraries.md](docs/native-libraries.md).

## [0.11.0] - 2026-09-15

### Breaking changes

- Credential-only calls no longer publish temporary login/session/logout events.
  Use `onAuthEvent` operation events and the returned credential promise instead.
- Native binaries must be rebuilt because the generated Nitro contract changed.

### Added

- Add atomic session snapshots and a shared snapshot subscription for `useAuth()`.
- Add correlated async operation events with IDs, elapsed milliseconds, and typed
  failure codes. Listener exceptions and queued unsubscribe delivery are isolated.
- Return login users and local scope revocation results from the native mutation.
- Replace manual native result bridges with a generated Swift/Kotlin Nitro adapter.

- Apple Sign-In on Android through an HTTPS broker, using the same `login()`
  and `getCredential()` calls as iOS. The Expo plugin configures the callback;
  nonce, proof, browser lifecycle, and credential exchange stay in the package.
- Export `AppleAndroidLoginOptions` and `AppleAndroidScope` for Android callers.
- Add `AuthService.getCredential()` for nonce-bound Google and Apple ID tokens,
  with native OS nonce generation and no retained package session.
- Add optional structured `firstName` and `lastName` fields to `AuthUser`.
- Add Google and Apple `SocialButton` custom, image, and SVG render modes,
  including official icon-only artwork, per-provider visual overrides, and
  controlled loading with async press handlers.
- Add `SocialProviderIcon` and provider content exports for custom buttons,
  a `loadingIndicator` override, and opt-in Google Sans through the Expo plugin's
  `googleButtonFont` setting. No render mode requires the font.
- Draw the official Google and Apple marks from images in every render mode,
  including busy states and `SocialProviderIcon`.

### Fixed

- Accept fractional-millisecond provider expiry timestamps on native platforms,
  preventing valid iOS Google and Microsoft results from failing with `parse_error`.
- Failed event subscriptions release their listeners, and snapshot dispatch
  skips listeners unsubscribed earlier in the same dispatch.
- Social buttons keep the provider mark, chrome, and size while loading, so
  turning `loading` on or off never moves or resizes the control. Labeled
  buttons place the indicator beside the mark; icon-only buttons dim the mark
  and center the indicator over it.
- Center marks and labels in custom mode, and size icon-only marks from the
  official ratios instead of cropping them.
- `svg` mode renders correctly on native. Apple's vector export nested `<svg>`
  viewports that native renderers placed wrong, and Google's drew its mark with
  a Figma conic gradient inside a `foreignObject` that no native renderer
  supports. The artwork is flattened, and the Google mark image is drawn into
  its box.
- Custom mode no longer asks for a Google Sans family that the app may not
  bundle; it uses the platform system font and accepts a family via `textStyle`.
- Remove the placeholder text glyph from the Microsoft button and keep its label
  in place while it is busy.
- Android maps Apple's authorization code into `AuthUser.authorizationCode`.
- Native Apple sessions reject unsupported refresh and scope upgrades without
  invoking another provider or changing the current session.
- Android registers the native Auth module eagerly and resolves an already
  resumed Activity when initialization happens after app launch.
- Credential acquisition now rejects before provider setup when a package
  session is already active, preserving that session and its listeners.
- Android nonce-bearing Google sign-in now stays on Credential Manager and
  rejects on missing or mismatched nonce credentials instead of falling back
  to legacy Google Sign-In.

## [0.10.2] - 2026-09-10

### Breaking changes

- None.

### Fixed

- iOS builds using static frameworks and source-built React Native now resolve
  Folly and React Native headers when compiling the Nitro Swift/C++ bridge.

## [0.10.1] - 2026-09-09

### Breaking changes

- None.

### Fixed

- Apply the Kotlin Android plugin only when the Gradle Kotlin extension is
  absent, so AGP 9 consumers that already ship built-in Kotlin can configure
  the library.

## [0.10.0] - 2026-08-25

### Breaking changes

- None when upgrading from `0.9.x`. Direct upgrades from `0.8.x` or earlier
  still require Nitro Modules `0.37.x` and a native rebuild as described in
  the `0.9.0` entry.

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

- Web popup completion polling now runs every 500 ms, reducing background
  main-thread wakeups while preserving redirect and cancellation behavior.
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

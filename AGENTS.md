# AGENTS.md — react-native-nitro-auth

## Project Overview

React Native Nitro module for authentication (Google, Apple, Microsoft). C++ core with iOS/Android native bridges and a web implementation.

## Structure

- `packages/react-native-nitro-auth/` — published library
- `apps/example/` — Expo example app
- Monorepo: bun workspaces (no Turborepo)

## Commands

- `bun install` — install deps
- `bun run codegen` — regenerate Nitro specs (nitrogen)
- `bun run build` — build library (bob)
- `bun run test` — run Jest tests; `bun run test:cpp` runs the C++ suites
- `bun run test:cpp:sanitize` runs the C++ suites under ASan+UBSan and TSan (part of `check:ci`). `bun run test:swift` runs the SwiftPM tests for `ios/AuthCore.swift` on macOS; it is a separate `ci.yml` step, not part of `check:ci`, because the publish workflow runs `check:ci` on Linux. `bun run android:test` runs the Kotlin unit tests through the generated example Android project; run it locally before a release (it needs `apps/example/android`, so run it before a clean prebuild removes build state).
- `bun run release:preflight` — run release gate, Expo SDK checks, config introspection, and package dry run

## Design Decisions

- **In-memory token storage is intentional.** Microsoft refresh tokens and all tokens are kept in memory only. The consuming project decides its own persistence/secure-storage strategy. This is NOT a bug — do not flag it.
- **JWT signature validation is the server's responsibility.** Client-side JWT decode is for display only. Native payload splits live in `cpp/AuthCrypto.cpp`; do not add jwt-cpp or client signature verify.

## Key Patterns

- `AuthAdapter.swift` / `AuthAdapter.kt` — platform bridges
- `HybridAuth.cpp` — shared C++ HybridObject (Nitro)
- `PlatformAuth.cpp` + `HybridNativeAuthAdapter.swift` / `HybridNativeAuthAdapter.kt` — Nitro adapter bridge to the platform code
- `service.ts` / `service.web.ts` — JS service layer (wraps native calls, maps errors to `AuthError`)
- `Auth.web.ts` — full web OAuth implementation
- Error contract: all public-facing errors must be `AuthError` instances with `AuthErrorCode`

## Pitfalls

- After upgrading nitrogen, delete stale `packages/react-native-nitro-auth/node_modules/nitrogen/` before codegen
- Nitro `0.35.1+` autolinking expects `"c++"` in `nitro.json`, not `"cpp"`
- `HybridAuth.cpp` lambdas capturing `this` — must use `shared_from_this()` or `weak_from_this()` for safety
- `shared_from_this()` returns `shared_ptr<HybridObject>` (virtual base) — must use `dynamic_cast<HybridAuth*>`, NOT `static_cast`
- Android `moduleScope` must be recreated after `dispose()` — cancelling it is permanent
- `HybridAuth::refreshToken` rejects `operation_in_progress` while a login, requestScopes or silentRestore is pending; it never cancels them
- `./official-buttons` must stay free of `react-native-svg` and SVG artwork; SVG rendering lives in `./official-buttons/svg` (guarded by `social-button-import-graph.test.ts`)
- Web `index.web.ts` must mirror exports from `index.ts` (e.g., `AuthError`)
- Example React Compiler is on (`experiments.reactCompiler`). Never write try/finally without catch inside a React component or hook. The compiler cannot lower it ("Handle TryStatement without a catch clause") and skips the whole function. Use promise.finally() for async cleanup, or a real catch that handles or reports the error. try/catch/finally is not this bailout. Example lint fails that form (`TryStatement[handler=null]` via `compiler-bailout/no-try-without-catch`). A compiler bailout fails the check. It is not a type or lint warning to ignore.
- The example app uses Expo CNG; `apps/example/android` and `apps/example/ios` are generated local artifacts and should not be hand-edited or committed.
- Keep `expo-build-properties` `ios.usePrecompiledModules` disabled for the example app until Expo/Xcode precompiled module linking is proven stable; with Xcode 26.5 the precompiled Expo module path produced `SwiftUICore`/`ExpoFileSystem` link failures while source-built Expo modules passed.

## Code Style

- kebab-case file names
- No `any` casts — type properly
- Early returns over deep nesting
- `StyleSheet.create` for styles, no inline style objects
- Conventional commits: `fix:`, `feat:`, `chore:`, `refactor:`, `docs:`
- PR body is the current version's CHANGELOG section. The GitHub release
  description must match it. Do not add Summary, Test plan, or extra sections.

## Replay maintenance

- Review `e2e/auth-replay-coverage.json` and the affected `.ad` assertions whenever package runtime or example behavior changes. Update them before refreshing the source lock with `bun run example:replay:refresh`.
- Flows assert smoke rows through the on-screen `smoke-results` label because agent-device `.ad` waits only see on-screen elements.
- Keep `example:replay:check` and `example:replay:test` in the normal quality gate. They are device-free; refreshing a digest does not prove runtime behavior.
- Run `example:replay` only against an explicit platform and device identifier, using the matching installed example. Keep device execution out of CI and artifacts in OS temp.
- Signed-out checks, cancellation, button rendering, and provider authentication are distinct evidence. Keep provider-dependent rows pending until their configured account, platform, and server prerequisites are verified.

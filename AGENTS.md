# React Native Nitro Auth - Agent Notes

Nitro Auth must stay provider-driven and stateless by default.

## Essentials

- Use `bun` / `bunx` only.
- Run monorepo dependency changes from root and verify both `packages/react-native-nitro-auth` and `apps/example`.
- Keep native auth stateless: no internal token/user/session persistence in iOS/Android.
- Do not reintroduce storage-adapter exports/functions in public API.
- If auth payload shape changes, also update:
  - `/Users/jota/Workspace/Projects/RN-Packages/react-native-nitro-auth/README.md`
  - `/Users/jota/Workspace/Projects/RN-Packages/react-native-nitro-auth/apps/example/components/FeatureDemo.tsx`
  - `/Users/jota/Workspace/Projects/RN-Packages/react-native-nitro-auth/packages/react-native-nitro-auth/src/__tests__`

## Detailed Instructions

- [Auth Contract](docs/agent-instructions/auth-contract.md)
- [Web and Example Persistence](docs/agent-instructions/web-and-example-persistence.md)
- [Tooling and Verification](docs/agent-instructions/tooling-and-verification.md)

## Regression Guards

- Keep token refresh single-flight on both web and C++ `HybridAuth` to prevent parallel refresh storms.
- Keep `AuthService.onAuthStateChanged` as payload passthrough; do not re-read `currentUser` inside callback wrappers.
- Web auth config/storage mode is resolved once per module instance; avoid re-probing browser storage on each read/write.
- Keep Apple web SDK loading idempotent (single script load promise).
- JWT payload parsing must support base64url (`-`, `_`, missing padding) across web/iOS Microsoft flows.
- Android C++ bridge pending promises are replace-and-reject; never silently overwrite in-flight `login/requestScopes/refresh/silentRestore`.
- In Android `fbjni` code, prefer `local_ref<JString>` for `make_jstring(...)` values and avoid ternary mixes with `local_ref<jstring>` (ambiguous conversion on NDK clang).
- Keep `bun run verify:core-versions` passing: `react`/`react-dom` pinned to `19.1.0` and `react-native` pinned to `0.81.5`.
- Expo SDK 54 / compileSdk 35 compatibility: keep `androidx.browser` on `1.8.x` (1.9+ requires compileSdk 36).

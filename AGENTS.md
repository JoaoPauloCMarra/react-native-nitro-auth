# React Native Nitro Auth - Agent Notes

- Use `bun`/`bunx` only.
- Monorepo dependency updates: run from root, then verify `packages/react-native-nitro-auth` and `apps/example`.
- Keep package auth-only and stateless on native:
  - No internal persistence in iOS/Android for user/session/token data.
  - `silentRestore()` should rely on provider SDK session restore only.
  - Never dereference `std::optional<AuthUser>` without checking (`silentRestore` crash risk on iOS).
- App-owned persistence belongs in consuming apps (example uses `react-native-nitro-storage` Disk).
- Example persistence rule: keep Disk snapshot across refresh/restart, clear snapshot only on explicit logout.
- Public API must not reintroduce storage adapter exports/functions.
- If auth payload shape changes, update:
  - `/Users/jota/Workspace/Projects/RN-Packages/react-native-nitro-auth/README.md`
  - `/Users/jota/Workspace/Projects/RN-Packages/react-native-nitro-auth/apps/example/components/FeatureDemo.tsx`
  - tests in `/Users/jota/Workspace/Projects/RN-Packages/react-native-nitro-auth/packages/react-native-nitro-auth/src/__tests__`

# Tooling and Verification

## Tooling Baseline

- Use `eslint-config-expo-magic` flat config.
- Keep these scripts available in Turbo workspaces when relevant:
  - `format`
  - `format:check`
  - `lint`
  - `typecheck`

## Monorepo Update Scope

- Run dependency updates from repo root.
- Verify both:
  - `packages/react-native-nitro-auth`
  - `apps/example`

## README Accuracy

- Keep provider field availability documented.
- Explicitly document Android Google missing direct `accessToken`.
- Do not document removed storage-adapter APIs.

## Device Verification Fallback

- If Maestro returns `UNAVAILABLE: io exception` on Android emulator sessions, validate UI using:
  - `adb exec-out screencap -p`

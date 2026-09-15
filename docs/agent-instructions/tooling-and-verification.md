# Tooling and Verification

## Tooling Baseline

- Use `eslint-config-expo-magic` flat config.
- This repository uses Bun workspaces, without Turborepo. Use its declared
  `format:check`, `lint`, `typecheck`, `check:ci`, and `release:preflight` scripts.
- Native builds and runtime checks run locally; CI does not build example apps.
- Run `bun run sync-package-docs` after editing root README, CHANGELOG, or
  SECURITY. Docs are copied into the package by the pack lifecycle; do not
  maintain a separate handwritten package-doc tree.

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

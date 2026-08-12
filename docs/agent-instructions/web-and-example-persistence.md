# Web and Example Persistence

## Web Defaults

- Default web cache is `sessionStorage` and should remain non-sensitive.
- Sensitive tokens must remain memory-only unless explicitly enabled by
  consumers (`nitroAuthPersistTokensOnWeb`).
- Profile metadata (email, name, photo) is persisted by default; disable with
  `nitroAuthPersistProfileOnWeb: false`.
- A custom storage adapter changes WHERE values are stored, never WHETHER
  tokens may be persisted.
- `expo-constants` is an optional peer dependency used for web provider
  config; without it web falls back to defaults.

## Package and Example Parity

- Keep package behavior stateless on web by setting:
  - `expo.extra.nitroAuthWebStorage = "memory"`
- Example persistence belongs to app-level storage, not package internals.

## Example App Persistence Rules

- Use `react-native-nitro-storage` Disk in `apps/example` (`localStorage`
  fallback on web).
- Keep Disk snapshot across refresh/restart.
- Clear snapshot only on explicit logout.
- Merge token refresh events into the snapshot so `accessToken` and
  `expirationTime` survive reloads.

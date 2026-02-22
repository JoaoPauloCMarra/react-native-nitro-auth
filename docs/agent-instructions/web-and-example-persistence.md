# Web and Example Persistence

## Web Defaults

- Default web cache is `sessionStorage` and should remain non-sensitive.
- Sensitive tokens must remain memory-only unless explicitly enabled by consumers.

## Package and Example Parity

- Keep package behavior stateless on web by setting:
  - `expo.extra.nitroAuthWebStorage = "memory"`
- Example persistence belongs to app-level storage, not package internals.

## Example App Persistence Rules

- Use `react-native-nitro-storage` Disk in `apps/example` (`localStorage` fallback on web).
- Keep Disk snapshot across refresh/restart.
- Clear snapshot only on explicit logout.
- Merge token refresh events into the snapshot so `accessToken` and `expirationTime` survive reloads.

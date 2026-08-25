# Web and Example Persistence

## Web Defaults

- Default web cache is `sessionStorage` and should remain non-sensitive.
- Sensitive tokens must remain memory-only unless explicitly enabled by
  consumers (`nitroAuthPersistTokensOnWeb`).
- Profile metadata (email, name, photo) is persisted by default; disable with
  `nitroAuthPersistProfileOnWeb: false`.
- A custom storage adapter retains legacy token persistence when
  `nitroAuthPersistTokensOnWeb` is omitted. New integrations must set the
  option explicitly.
- `expo-constants` is an optional peer dependency used for web provider
  config; without it web falls back to defaults.

## Package and Example Parity

- Keep package behavior stateless on web by setting:
  - `expo.extra.nitroAuthWebStorage = "memory"`
- Example persistence belongs to app-level storage, not package internals.

## Example App Persistence Rules

- The example's optional "Keep session snapshot in memory" setting stores a
  display-only snapshot in React state; it does not persist across refresh or
  restart and does not replace `AuthService` session state.
- Clear the in-memory snapshot on explicit logout.
- Merge token refresh events into the in-memory snapshot for display only; this
  does not change package token storage.
- Durable consumer persistence belongs in app-level storage, not package
  internals.

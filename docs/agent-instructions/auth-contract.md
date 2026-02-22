# Auth Contract

## Native Stateless Rule

- No internal persistence in iOS/Android for user, session, or token data.
- `silentRestore()` must rely on provider SDK session restore only.
- Never dereference `std::optional<AuthUser>` without checking.

## Login and Token Semantics

- `HybridAuth::login` scope precedence:
  - provider-returned scopes first
  - requested option scopes second
  - otherwise empty scopes
- Never overwrite provider scopes with empty requested scopes.

## Android Google Provider

- Google One Tap/Legacy on Android provides `idToken` and optional `serverAuthCode`.
- It does not provide direct OAuth `accessToken`.
- Derive `expirationTime` from the ID token `exp` claim for UI parity.

## Type Safety

- Keep `Auth.web` runtime guards intact:
  - `parseAuthUser`
  - `parseScopes`
  - `parseResponseObject`
- Refresh paths must return the full `AuthTokens` shape.

## Public API Boundary

- Public API must not reintroduce storage-adapter exports/functions.

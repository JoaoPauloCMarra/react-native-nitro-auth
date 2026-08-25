# Auth Contract

The canonical cross-platform contract is `docs/error-contract.md`. This file
summarizes the invariants agents must preserve.

## Native Stateless Rule

- Native token fields remain in process memory. Android may persist only
  non-secret Google session metadata (session kind, account identity, and the
  requested hosted-domain configuration) to correlate restored provider state.
- `silentRestore()` must rely on provider SDK session restore, not package token
  persistence.
- Never dereference `std::optional<AuthUser>` without checking.

## Login and Token Semantics

- `HybridAuth::login` scope precedence:
  - provider-returned scopes first
  - requested option scopes second
  - otherwise empty scopes
- Never overwrite provider scopes with empty requested scopes.
- `expirationTime` is the access-token expiry in epoch milliseconds; Android
  Google uses the documented ID-token `exp` fallback
  (`AuthAdapter.getGoogleExpirationTimeMs`).

## Android Google Provider

- Google One Tap/Legacy on Android provides `idToken` and optional
  `serverAuthCode`.
- It does not provide direct OAuth `accessToken`.
- Derive `expirationTime` from the ID token `exp` claim for UI parity.
- Capabilities are exported through `getProviderTokenCapabilities`.

## Error Envelope

- Native boundaries reject with `<code>` or `<code>: <detail>`; the code
  prefix is the contract and message text is never control flow.
- `AuthError` carries `code`, `operation` (the failed phase), and
  `underlyingMessage`.
- One canonical OAuth error table (`src/utils/oauth-error.ts`) is shared by
  iOS, Android, and web; refresh operations surface grant failures as
  `refresh_failed`.

## Session Lifecycle

- Scenario corpus SC-01…SC-09 in `src/__tests__/session-scenarios.test.ts`
  runs against the web and native backends; the same scenarios run in C++.
- Logout settles in-flight refresh with `not_signed_in`; dispose rejects
  pending work with `cancelled`, clears listeners, and performs platform
  logout.
- Silent restore never opens interactive UI; near-expiry Google sessions
  reject with `interaction_required`.
- Web popups are matched against the exact registered redirect target, and
  `state`/`nonce` are verified before provider responses are parsed.

## Type Safety

- Keep `Auth.web` runtime guards intact:
  - `parseAuthUser`
  - `parseScopes`
  - `parseResponseObject`
- Refresh paths must return the full `AuthTokens` shape.

## Public API Boundary

- Public API must not reintroduce storage-adapter exports/functions.
- `AuthUser.underlyingError` is deprecated; structured details live on
  `AuthError`.
- Default browser storage requires explicit `nitroAuthPersistTokensOnWeb`
  opt-in; custom storage adapters retain legacy token persistence when the
  option is omitted. Profile PII persistence is controlled by
  `nitroAuthPersistProfileOnWeb`.

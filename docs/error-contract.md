# Auth Contract

This document is the single source of truth for cross-platform behavior.
Code on every platform (web `src/Auth.web.ts`, iOS `ios/AuthAdapter.swift`,
Android `AuthAdapter.kt`, and the C++ coordinator `cpp/HybridAuth.cpp`) must
agree with it. Fixture tests that enforce parts of it live in
`src/__tests__/oauth-error.test.ts`, `src/__tests__/oauth-token-client.test.ts`,
`src/__tests__/session-scenarios.test.ts`, and
`cpp/__tests__/HybridAuthTests.cpp`.

## 1. Error envelope (U1, X2)

Every public failure is an `AuthError` with:

- `code` — a stable `AuthErrorCode`, safe to switch on;
- `operation` — the phase that failed (`login`, `getCredential`, `requestScopes`, `revokeScopes`,
  `revokeAccess`, `getAccessToken`, `refreshToken`, `silentRestore`, `logout`,
  `dispose`), attached by the service boundary;
- `underlyingMessage` — the raw platform/provider detail when it differs from
  the code.

Native boundaries reject with `<code>` or `<code>: <detail>` envelopes; the
code prefix is the contract. Native control flow uses typed codes; the JS
compatibility boundary parses the prefix. Native `underlyingMessage` retains
the full differing exception message, including its code prefix; structured
web errors preserve their separate detail. Consumers must not parse detail
text for control flow or forward it to telemetry without redaction. Web throws
`AuthWebError(code, underlyingError)`, which the service converts into the
public `AuthError` envelope. `AuthUser.underlyingError` is deprecated and
reserved for compatibility; structured details live on `AuthError`.

Getters and subscription setup can fail without an operation. An existing
`AuthError` is preserved unchanged by `AuthError.from()`, including its existing
or missing operation.

### Canonical OAuth error table

Identical provider error strings produce identical codes on every platform.
`context` selects the operation bucket: `authorize`/`token` surface token
failures as `token_error`; `refresh` surfaces them as `refresh_failed`.

| Provider error            | Code                             |
| ------------------------- | -------------------------------- |
| `access_denied`           | `cancelled`                      |
| `user_cancelled`          | `cancelled`                      |
| `popup_closed_by_user`    | `cancelled`                      |
| `interaction_required`    | `interaction_required`           |
| `login_required`          | `interaction_required`           |
| `consent_required`        | `interaction_required`           |
| `invalid_client`          | `configuration_error`            |
| `invalid_scope`           | `configuration_error`            |
| `unauthorized_client`     | `configuration_error`            |
| `invalid_grant`           | `token_error` / `refresh_failed` |
| `invalid_request`         | `token_error` / `refresh_failed` |
| `invalid_token`           | `token_error` / `refresh_failed` |
| `server_error`            | `network_error`                  |
| `temporarily_unavailable` | `network_error`                  |
| anything else             | `unknown`                        |

## 2. Token semantics (U2, X6)

- `expirationTime` is the **access-token expiry** in epoch milliseconds on
  every platform.
- The returned user's Google `hostedDomain` reports the requested
  configuration. Android retains this non-secret value across module/process
  recreation only for the matching restored account identity; logout and
  account replacement clear it. iOS uses the restored Google account
  configuration, while web reports the provider token claim when present.
- `requestScopes` resolves for every stored session type on every platform:
  legacy Google, Credential Manager/One-Tap Google (Android keeps the
  one-tap session in memory and resolves with the merged scope list), GID
  Google (iOS re-prompts), and Microsoft (re-consent via the browser flow).
- Android Google never returns an OAuth access token; its `expirationTime`
  uses the documented ID-token `exp` fallback
  (`AuthAdapter.getGoogleExpirationTimeMs`).
- Typed capabilities are exported via
  `getProviderTokenCapabilities(provider, platform)` and the
  `ProviderTokenCapabilities` type. Android Google reports
  `supportsAccessToken: false`; Apple reports no client-side token support.
- `getAccessToken()` refreshes near-expiry sessions (5-minute skew) when the
  provider supports client-side refresh.

## 3. Session lifecycle (U3, items 8–10)

The scenario corpus `SC-01…SC-09` runs against the web module, the native
service boundary, and the C++ coordinator:

| Scenario | Contract                                                                |
| -------- | ----------------------------------------------------------------------- |
| SC-01    | Login success exposes the user and notifies state listeners.            |
| SC-02    | Login failure leaves no user and a typed code.                          |
| SC-03    | Logout cancels an in-flight refresh; it settles with `not_signed_in`.   |
| SC-04    | Logout clears user and scopes and notifies listeners.                   |
| SC-05    | Dispose rejects a pending login with `cancelled`.                       |
| SC-06    | Concurrent refresh calls share one in-flight operation.                 |
| SC-07    | Silent restore without a session resolves without a user.               |
| SC-08    | Refresh failure settles with a typed code and the `refreshToken` phase. |
| SC-09    | Concurrent login settles every promise with a typed result.             |

SC-09 divergence (documented, not a parity defect): native cancels the first
login (generation advance); the replacement settles with the platform result,
which may include `operation_in_progress` while provider UI is still active.
Web keeps the first request active and rejects the second with
`operation_in_progress`. C++ mock tests prove coordinator settlement, not actual
provider UI teardown timing.

- `dispose()` rejects pending session and refresh work, clears listeners and
  tokens, and performs platform logout.
- Service listeners isolate exceptions, and unsubscribe suppresses queued JS
  delivery. Snapshot observers follow service recreation; other subscriptions
  end when disposed.

### Credential acquisition

`AuthService.getCredential()` supports Google and Apple and returns
`{provider, idToken, nonce, user}` without publishing a package session.
It rejects an existing session with `invalid_state` before provider setup.
Overlapping credential/session operations reject with `operation_in_progress`.
Logout/disposal invalidate pending credential work. A primary failure takes
precedence over a subsequent cleanup failure; cleanup failure rejects an
otherwise successful acquisition. C++ transaction tests and web/service tests cover these cases.

Nonce generation is platform-owned on native and uses Web Crypto on web.
`getCredential()` passes the SHA-256 nonce to the provider and returns its raw
counterpart. It emits operation events without temporary session events.
Provider verification remains the server's responsibility.

## 4. OAuth token client (U4, item 11)

`src/utils/oauth-token-client.ts` defines the shared request/response contract:
`buildAuthorizationCodeBody`, `buildRefreshTokenBody`, `parseTokenResponse`,
and `parseExpiresInMilliseconds`. iOS and Android build identical bodies and
parse identical responses; the fixture corpus in
`src/__tests__/oauth-token-client.test.ts` is the contract for both ports.

## 5. Redirect and popup hardening (U4, items 5, 7, 19)

- Web redirects are accepted only when they match the exact registered target
  (origin root with an optional `#`/`?` section); other paths are rejected.
- Google and Microsoft redirects require a matching `state` before any parsing
  (`invalid_state` otherwise), and Google/Microsoft/Apple identity tokens
  require the expected `nonce` (`invalid_nonce` otherwise).
- The web Google code path sends `state`; PKCE verifier exchange is
  intentionally server-side for Google (the package hands `serverAuthCode` to
  the backend), so no verifier is generated for Google. Microsoft uses
  PKCE S256 end-to-end on every platform.
- Google/Microsoft popup completion polls every 500 ms when its location can be
  read, backs off to 1000 ms while cross-origin, and times out after 120 s.
  This implementation does not use a callback-page message protocol.
- Silent restore never opens interactive UI: a near-expiry Google session
  rejects with `interaction_required`.

## 6. Persistence and PII (U4 item 12, U6 item 23)

- With the default browser storage, web tokens are memory-only unless
  `nitroAuthPersistTokensOnWeb` is explicitly enabled. A custom storage
  adapter keeps the pre-0.7 token-persistence behavior when the option is
  omitted; set the option explicitly in new integrations. Persisted tokens
  widen the XSS exposure.
- Profile metadata (email, name, photo) is persisted by default; set
  `nitroAuthPersistProfileOnWeb: false` to keep it memory-only. Token fields
  and the Microsoft refresh token remain memory-only with the default browser
  storage unless token persistence is enabled.
- Native token fields are process-memory only.

## 7. Observability (U6, item 20)

`onAuthEvent` delivers the named login, refresh, session, logout, and dispose
events plus correlated async service operation events. `AuthLifecycleEvent` is
the full union. Each async call emits `operation_started` and one terminal
`operation_succeeded` or `operation_failed`, with `operationId`, `operation`,
optional `provider`, terminal `elapsedMilliseconds`, and failure `errorCode`.
Validation failures also receive a pair. Disposal terminates pending event pairs
with `cancelled` before removing event listeners. These payloads never include
tokens, profile data, or raw provider messages.

State, snapshot, and token subscriptions contain authentication data and must
not be forwarded to telemetry. Each callback is isolated. Unsubscribe is
idempotent and prevents queued callback delivery at the service boundary.
Web legacy state subscriptions deliver an initial value; native ones do not.
Snapshot consumers read after registration to close that gap.

Refresh dispatches state, token data, then its named lifecycle event. Native JS
callbacks are asynchronous: do not assume ordering against promise settlement
or operation-event delivery. See [architecture](native-performance-plan.md).

## 8. Revocation (U6, item 22)

- `revokeScopes` is local-only on every platform and retains its
  `Promise<void>` return for compatibility. `revokeScopesWithResult` is the
  additive method that returns
  `ScopeRevocationResult { revokedAtProvider: false, revokedScopes }`.
- `revokeAccess()` performs provider revocation where supported (Google web/iOS,
  Android legacy Google) and only clears local state after provider
  revocation succeeds. When no eligible Google session exists, every platform
  rejects with `not_signed_in`; providers without client-side revocation
  reject with `unsupported_provider`.
- Modern Android Google sessions created through Credential Manager/One-Tap are
  not eligible for client-side provider revocation and reject with
  `unsupported_provider`.
- Web Google revocation can also reject with `token_error` when the current
  Google session has no access token; this is a web-provider contract, not a
  claim that every platform exposes the same token.

## 9. Apple nonce (U6, item 21)

When a nonce is provided, the returned Apple identity token's `nonce` claim
must match on iOS (`AppleSignInDelegate`) and web; mismatches reject with
`invalid_nonce`. The web flow always generates a nonce when none is provided.

Android Apple uses the HTTPS broker contract in the README. `getCredential()`
supplies the hashed nonce and returns its raw counterpart to the caller. Direct
`login("apple", {nonce})` accepts a 64-character lowercase SHA-256 hex nonce;
omitting it generates one. The broker must verify the returned identity token's
signature, issuer, audience, expiry, and nonce before returning credentials.

Missing/invalid Android broker configuration rejects with `configuration_error`.
Invalid nonce or scopes reject before browser launch. Broker JSON with missing,
empty, non-string required credentials, or a response above 64 KiB rejects with
`parse_error`. HTTP redirects are never followed. Transport failures use
`network_error`; request and interactive deadlines use `timeout`. An Apple
`APPLE_AUTHORIZATION_CANCELLED` response and browser dismissal map to `cancelled`.
Raw server error messages never reach the public error detail.

Only the current attempt's exact callback scheme, host `apple`, path `/callback`,
and single UUID `attemptId` are accepted. Unexpected, duplicate, and stale
callbacks cannot consume credentials. Logout, disposal, and replacement requests
invalidate the pending attempt. Native Apple `refreshToken()` and
`requestScopes()` reject with `unsupported_provider` without changing the session
or invoking another provider.

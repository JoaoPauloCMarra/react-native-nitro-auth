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
- `operation` — the phase that failed (`login`, `requestScopes`, `revokeScopes`,
  `revokeAccess`, `getAccessToken`, `refreshToken`, `silentRestore`, `logout`,
  `dispose`), attached by the service boundary;
- `underlyingMessage` — the raw platform/provider detail when it differs from
  the code.

Native boundaries reject with `<code>` or `<code>: <detail>` envelopes; the
code prefix is the contract and message text is never control flow. Web throws
`AuthWebError(code, underlyingError)`, which the service converts into the
public `AuthError` envelope. `AuthUser.underlyingError` is deprecated and
reserved for compatibility; structured details live on `AuthError`.

### Canonical OAuth error table

Identical provider error strings produce identical codes on every platform.
`context` selects the operation bucket: `authorize`/`token` surface token
failures as `token_error`; `refresh` surfaces them as `refresh_failed`.

| Provider error                  | Code                        |
| ------------------------------- | --------------------------- |
| `access_denied`                 | `cancelled`                 |
| `user_cancelled`                | `cancelled`                 |
| `popup_closed_by_user`          | `cancelled`                 |
| `interaction_required`          | `interaction_required`      |
| `login_required`                | `interaction_required`      |
| `consent_required`              | `interaction_required`      |
| `invalid_client`                | `configuration_error`       |
| `invalid_scope`                 | `configuration_error`       |
| `unauthorized_client`           | `configuration_error`       |
| `invalid_grant`                 | `token_error` / `refresh_failed` |
| `invalid_request`               | `token_error` / `refresh_failed` |
| `invalid_token`                 | `token_error` / `refresh_failed` |
| `server_error`                  | `network_error`             |
| `temporarily_unavailable`       | `network_error`             |
| anything else                   | `unknown`                   |

## 2. Token semantics (U2, X6)

- `expirationTime` is the **access-token expiry** in epoch milliseconds on
  every platform.
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

| Scenario | Contract |
| -------- | -------- |
| SC-01    | Login success exposes the user and notifies state listeners. |
| SC-02    | Login failure leaves no user and a typed code. |
| SC-03    | Logout cancels an in-flight refresh; it settles with `not_signed_in`. |
| SC-04    | Logout clears user and scopes and notifies listeners. |
| SC-05    | Dispose rejects a pending login with `cancelled`. |
| SC-06    | Concurrent refresh calls share one in-flight operation. |
| SC-07    | Silent restore without a session resolves without a user. |
| SC-08    | Refresh failure settles with a typed code and the `refreshToken` phase. |
| SC-09    | Concurrent login settles every promise with a typed result. |

SC-09 divergence (documented, not a parity defect): native cancels the first
login (generation advance) and the platform rejects the duplicate with
`operation_in_progress`; web keeps the first popup alive (browser-owned,
cannot be closed cross-origin) and rejects the second with
`operation_in_progress`.

- `dispose()` rejects pending session and refresh work, clears listeners and
  tokens, and performs platform logout.
- Listener exceptions are isolated per listener on every platform.

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
- Popup completion polls every 500 ms (event-driven completion is impossible
  cross-origin) and times out after 120 s.
- Silent restore never opens interactive UI: a near-expiry Google session
  rejects with `interaction_required`.

## 6. Persistence and PII (U4 item 12, U6 item 23)

- Web tokens are memory-only unless `nitroAuthPersistTokensOnWeb` is
  explicitly enabled. A custom storage adapter changes WHERE values are
  stored, never WHETHER tokens may be persisted. Persisted tokens widen the
  XSS exposure.
- Profile metadata (email, name, photo) is persisted by default; set
  `nitroAuthPersistProfileOnWeb: false` to keep it memory-only. Token fields
  and the Microsoft refresh token are never persisted without opt-in.
- Native token fields are process-memory only.

## 7. Observability (U6, item 20)

`onAuthEvent` delivers privacy-safe typed events: `login_started`,
`login_succeeded`, `login_failed`, `tokens_refreshed`, `refresh_failed`,
`session_changed`, `logout`, `dispose`. Events carry `provider` and a typed
`errorCode` only — never tokens, payloads, or PII.

## 8. Revocation (U6, item 22)

- `revokeScopes` is local-only on every platform and returns
  `ScopeRevocationResult { revokedAtProvider: false, revokedScopes }`.
- `revokeAccess` performs provider revocation where supported (Google web/iOS,
  Android legacy Google) and only clears local state after provider
  revocation succeeds.

## 9. Apple nonce (U6, item 21)

When a nonce is provided, the returned Apple identity token's `nonce` claim
must match on iOS (`AppleSignInDelegate`) and web; mismatches reject with
`invalid_nonce`. The web flow always generates a nonce when none is provided.

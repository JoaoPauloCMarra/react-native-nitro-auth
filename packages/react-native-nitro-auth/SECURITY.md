# Security Policy

## Supported Versions

`react-native-nitro-auth` follows a rolling support window. Only the latest
released `0.x` line receives security fixes; earlier lines are supported only
while the release train is actively publishing them.

| Version   | Supported          |
| --------- | ------------------ |
| 0.13.x    | :white_check_mark: |
| older 0.x | :x:                |

## Credential And PII Rules

- Native token fields (including Microsoft refresh tokens) stay in process
  memory. Provider SDKs may retain their own sign-in state.
- On web, tokens stay memory-only unless `nitroAuthPersistTokensOnWeb` is
  `true` (default `false`). Persistence places credentials in browser storage
  and widens the XSS exposure.
- Profile metadata (email, name, photo) is persisted in browser storage by
  default on web; set `nitroAuthPersistProfileOnWeb: false` to keep profile
  PII out of storage.
- Never log tokens, authorization codes, nonce values, or full provider payloads.
  Lifecycle events contain typed metadata only; user/token listeners and
  `AuthError.underlyingMessage` must not be forwarded to telemetry automatically.
- OAuth redirects are verified against the exact registered origin/path, and
  state/nonce values are required before provider responses are parsed.
- Android Apple sign-in requires an HTTPS broker that validates the Apple ID
  token's signature, issuer, audience, expiry, and nonce, then releases the
  credential only with the one-time proof described in the README. Credentials
  must never be placed in the callback URL.
- `getCredential()` clears its temporary package session before resolving but
  returns sensitive credentials to the caller. The application server must
  verify them before creating its own session.

## Reporting A Vulnerability

Report security issues privately through GitHub private vulnerability
reporting:
https://github.com/JoaoPauloCMarra/react-native-nitro-auth/security/advisories/new

Do not open a public issue, pull request, or discussion for a vulnerability. Do
not include live credentials or tokens in any report. Disclosure happens after a
fix ships.

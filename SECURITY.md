# Security Policy

## Supported Versions

`react-native-nitro-auth` follows a rolling support window. Only the latest
released `0.x` line receives security fixes; earlier lines are supported only
while the release train is actively publishing them.

| Version    | Supported          |
| ---------- | ------------------ |
| latest     | :white_check_mark: |
| older 0.x  | :x:                |

## Credential And PII Rules

- Native token fields (including Microsoft refresh tokens) stay in process
  memory. Provider SDKs may retain their own sign-in state.
- On web, tokens stay memory-only unless `nitroAuthPersistTokensOnWeb` is
  explicitly enabled. Enabling it places credentials in the configured browser
  storage and widens the XSS exposure — review before enabling.
- Profile metadata (email, name, photo) is persisted in browser storage by
  default on web; set `nitroAuthPersistProfileOnWeb: false` to keep profile
  PII out of storage.
- Never log tokens, authorization codes, or full provider payloads. The
  package logs operation-level detail only.
- OAuth redirects are verified against the exact registered origin/path, and
  state/nonce values are required before provider responses are parsed.

## Reporting A Vulnerability

Report security issues privately to the maintainer instead of opening a public
issue: open a GitHub issue with the `security` label at
https://github.com/JoaoPauloCMarra/react-native-nitro-auth/issues, or contact
the repository owner directly. Do not include live credentials or tokens in
any report. Disclosure happens after a fix ships.

# Native libraries

OAuth UI and token exchange stay on the platform SDKs. Shared C++ owns the
nonce hash and JWT payload split used by iOS and Android.

## Kept

| Library | Where | Why |
| --- | --- | --- |
| In-tree SHA-256 + base64url | `cpp/AuthCrypto.cpp` | One ASCII-raw → lowercase hex contract for `createNonce()`, plus JWT payload bytes without signature verify. |

iOS calls the C ABI from `AuthAdapter`. Android prefers JNI and falls back to
`MessageDigest` / `Base64` in unit tests that do not load the native library.

## Evaluated and not shipped

| Library | Decision |
| --- | --- |
| jwt-cpp | Rejected. Decode-only payload split does not need a header-only JWT stack or OpenSSL. |
| AppAuth / MSAL | Rejected. Would replace working Google/Apple/Microsoft platform flows. |
| Client JWT signature verify | Rejected. Signatures, issuer, audience, and expiry stay a server responsibility. |

Web `createNonce()` and `parseJwtPayload()` stay on WebCrypto. In-memory token
storage is unchanged.

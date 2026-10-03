# Auth example smoke coverage

The maintained replay uses the example's installed release build. It expects
the package session to be signed out before the run. The replay checks that
precondition and stops if a user is present; it does not sign an existing user
out. It does not build the app, start Metro, or inject provider credentials.

The default Smoke Tests action covers public signed-out behavior: session
getters and snapshots, lifecycle listeners, operation event correlation,
typed token and scope results, `useAuth`, capability values, error mapping, and
logging controls. It leaves provider-dependent cancellation, credential,
restore, and dispose probes visibly `PENDING`. The completion text names those
pending provider checks. It stops after a failed signed-out precondition and
does not run later API probes against an existing account. A separate Provider
QA action can open native provider UI and is outside the default replay.

The visual button gallery is separate from authentication. Its Google and
Apple handlers only update the “Last visual button pressed” label. Image, SVG,
shape, appearance, icon-only, and loading assertions prove rendering and press
feedback only.

| Area                          | Default replay assertion                                                                                                                                                                        | Additional acceptance still pending                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Session getters and snapshots | Empty user and scopes agree with legacy getters; snapshot revision is a safe integer                                                                                                            | Coherent signed-in state and refreshed fields                                                                           |
| Session listeners             | On native, user and snapshot listeners receive a signed-out local scope update; throwing listeners are isolated; unsubscribe blocks later callbacks while an active control receives the update | Web local-revoke events, signed-in and provider-driven transitions                                                      |
| Lifecycle events              | A signed-out refresh failure has matching operation IDs, a typed `not_signed_in` code, and no credential fields                                                                                 | Real provider success and failure events                                                                                |
| Access token and scopes       | Signed-out access token is `undefined`; `revokeAccess` returns typed `not_signed_in`; local scope revoke is empty and says `revokedAtProvider: false`                                           | `requestScopes`, token refresh, scope consent, and provider revocation                                                  |
| Logout                        | Not invoked by the default replay                                                                                                                                                               | Provider SDK cleanup and account isolation on a dedicated test target                                                   |
| Silent restore                | Marked pending because it may restore a cached provider identity                                                                                                                                | Separate run on a dedicated QA target with known provider state                                                         |
| Login and credentials         | Provider login, `loginAndGetUser`, `getCredential`, cancellation, and disposal probes remain pending and are not called by default                                                              | Configured provider app, dedicated account, typed outcomes, and no published user after cancellation                    |
| Nonce                         | On iOS and Android, raw nonce has the expected base64url shape and hash has the SHA-256 hex shape; values are never rendered                                                                    | Web nonce API if supported; provider credential exchange and server signature, audience, expiry, and nonce verification |
| Capabilities and errors       | Public provider capability matrix and declared error codes match their concrete values                                                                                                          | Provider-specific results with configured SDKs                                                                          |
| Visual buttons                | Google and Apple presses update the gallery feedback label                                                                                                                                      | No authentication claim; provider login is covered separately                                                           |

Google, Apple iOS, Apple Android broker, Microsoft, `loginAndGetUser`, real
refresh and deduplication, scope consent, credential server verification,
logout cleanup, silent restore, and provider cancellation acceptance remain
`PENDING` until the prerequisites in [the replay coverage manifest](../e2e/auth-replay-coverage.json)
are met. A visual press, API-name check, setup error, or cancellation does not
close those rows.

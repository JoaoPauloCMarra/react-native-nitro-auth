# Example smoke coverage

The automated run clears only the example's package session. It requires no
provider IDs or accounts. A pass proves the signed-out behavior below; it does
not prove successful provider authentication.

| Feature                                  | Example runtime proof without providers                                                   | Additional provider acceptance                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Google, Apple, Microsoft `login`         | Each call is cancelled or returns its typed setup/unsupported error; no user is published | Successful sign-in and profile fields               |
| `loginAndGetUser`                        | Each provider's pending call settles without returning a cancelled user                   | Returned user belongs to the completed login        |
| Google/Apple `getCredential`             | Cancellation/setup failure leaves no package session                                      | Nonce-bound ID token and server verification        |
| Session getters and snapshot             | Empty user/scopes agree; revision is an integer                                           | Atomic signed-in state and refreshed fields         |
| `onSessionChanged`, `onAuthStateChanged` | Logout delivery, throwing listener isolation, queued unsubscribe suppression              | Signed-in transitions                               |
| `onTokensRefreshed`                      | Registration and idempotent cleanup                                                       | Real token refresh payload                          |
| `onAuthEvent`                            | Operation IDs, terminal timing, typed errors; no credential/detail fields                 | Real provider success/failure events                |
| `getAccessToken`, `refreshToken`         | Undefined token and typed signed-out rejection                                            | Expiry refresh and deduplication against provider   |
| `requestScopes`                          | Typed signed-out rejection                                                                | Provider consent                                    |
| `revokeScopes`, `revokeScopesWithResult` | Empty local result, `revokedAtProvider: false`                                            | Local reduction of granted scopes                   |
| `revokeAccess`                           | Typed signed-out rejection                                                                | Eligible Google revocation                          |
| `silentRestore`                          | Empty session settles without interactive UI                                              | Provider SDK restoration                            |
| `logout`, `dispose`                      | Empty state, cancellation, recreation and subsequent API use                              | Cleanup of real provider state                      |
| `useAuth`                                | Real hook actions, error paths, shared snapshot updates                                   | Signed-in rendering                                 |
| Capabilities and errors                  | Every provider/platform capability shape; all public error codes                          | Provider-specific capabilities with configured SDKs |
| Logging                                  | Toggle on/off                                                                             | No extra acceptance required                        |
| Social buttons                           | Custom/image/SVG gallery, Google/Apple press handlers, icon-only and loading controls     | Authentication handlers are covered separately      |

## Commands

1. `CI=1 bun run --cwd apps/example prebuild -- --platform android`
2. `bun run example:android:assemble`
3. Install the generated APK on the selected Android emulator and connect it to
   this example's Metro server. Use a free port and confirm server ownership.
4. `agent-device test e2e/qa-full-features.ad --device '<emulator name>'`
5. `CI=1 bun run --cwd apps/example prebuild -- --platform ios`
6. `bun run example:ios:build`
7. Install and launch the resulting app on the selected iOS simulator, then run
   `agent-device test e2e/qa-full-features.ad --device '<simulator name>'`.

Inspect package-owned runtime errors after each run. The smoke result must reach
`Complete: PASS`; a build alone or a screen that only lists APIs is insufficient.
Provider acceptance was excluded from this validation pass by user instruction.

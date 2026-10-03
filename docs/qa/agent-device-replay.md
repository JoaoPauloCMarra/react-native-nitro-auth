# Auth example `agent-device` replay

Use the gated package entry point. It runs the replay freshness check before
calling `scripts/run-example-replay.js`. The launcher reads flow IDs and `.ad`
paths from `e2e/auth-replay-coverage.json`. Without `--flow`, it runs every
listed flow in manifest order. Use `--flow` to select a single manifest ID:

```sh
bun run example:replay --platform ios --udid <exact-udid>
bun run example:replay --platform android --serial <exact-serial>
bun run example:replay --platform ios --udid <exact-udid> --flow credentials
```

| Flow ID               | File                            | Default | Scope                                                                                                 |
| --------------------- | ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `full-features`       | `e2e/qa-full-features.ad`       | yes     | Visual gallery presses, signed-out lab APIs, deterministic smoke rows                                 |
| `deeplink`            | `e2e/qa-deeplink.ad`            | yes     | `auth://e2e` route and signed-out state                                                               |
| `credentials`         | `e2e/qa-credentials.ad`         | yes     | Nonce shape, capability matrix, empty snapshot                                                        |
| `signed-out-extended` | `e2e/qa-signed-out-extended.ad` | yes     | Run-on-load guard, error envelope, Play Services, restore, logout, scope, Apple Android gate, dispose |
| `button-behavior`     | `e2e/qa-button-behavior.ad`     | yes     | SocialButton disabled, busy, error, Microsoft outline, icon size, busy propagation                    |

The selected `com.auth.example` release build must already be installed. Start
with the package session signed out. The full-features and deep-link flows
assert that state before running package checks; they do not clear an existing
session. The credentials flow reports a failed snapshot assertion if the
session is not empty. The signed-out-extended flow reports every check as
`requires-signed-out-session` if the session is not empty. Use a dedicated QA target and prepare its signed-out
state before launching the replay.

The runner requires `--platform ios` with one `--udid`, or `--platform android`
with one `--serial`. It rejects missing, ambiguous, duplicate, or cross-platform
target arguments before starting `agent-device`. It invokes the official
`agent-device test` command with fail-fast behavior, zero retries, one unique
session name, and one artifact directory under the operating system's temp
directory. Each flow ends with `close`. On failure, `agent-device test` closes
each attempt session itself. The runner does not prebuild, install, launch
Metro, or guess a device.

Run the freshness check and helper unit test separately when reviewing replay
coverage:

```sh
bun run example:replay:check
bun run example:replay:test
# Direct focused unit command:
bun test scripts/example-replay.test.ts
```

The source digest covers Auth runtime and native wiring, generated Nitro
bindings, example app and component source, assets, runtime configuration,
package manifests, and the workspace lockfile. It excludes tests, dependency
caches, build output, generated `apps/example/android` and
`apps/example/ios` projects, and secret environment files. The separate replay
digest covers every `.ad` flow listed in the manifest and the coverage
manifest. A stale digest or a
missing source assertion fails the static check. After reviewing a source or
flow change, update the assertion and manifest first, then refresh the lock and
re-run the gate:

```sh
bun scripts/check-example-replay-freshness.js --refresh
bun run example:replay:check
bun run example:replay:test
```

Do not refresh the lock to accept a missing assertion.

The default full-features flow presses the Google and Apple controls in the
visual gallery. Those handlers only update the “Last visual button pressed”
label. The flow then exercises signed-out public APIs and the deterministic
Smoke Tests action. It never calls provider `login`, `loginAndGetUser`,
`getCredential`, `requestScopes`, or `silentRestore`. Its loading step asserts
only the gallery toggle state, because `agent-device` `is` and `wait` cannot
read an accessibility busy state; the button-behavior flow proves that the
`loading` prop reaches the package content as busy and disabled. Flows assert smoke rows
through the on-screen `smoke-results` label because agent-device `.ad` waits
only see on-screen elements. The credentials flow
checks native nonce shape, provider capability values, and an empty session
snapshot without rendering nonce or token values. On web, native nonce coverage
is shown as pending. Local scope revocation does not emit session events on web,
so the two native listener probes are skipped and the smoke summary reports
partial coverage. Native listener assertions compare counts after subscription
and use an active control listener when checking unsubscribe behavior.

The signed-out-extended flow opens `auth://e2e-signed-out-extended`, which runs
its checks on load and joins one token per check into the on-screen
`e2e-ext-results` label. It calls native `logout`, `dispose`, `silentRestore`,
and `requestScopes(["email"])`, and on Android `login("apple")`, which must
reject `configuration_error` because the example build has no Apple broker. The
`getCredential("google")` call is rejected by the JavaScript in-progress guard
before any native request. Run it only on a disposable QA target with no cached
Google or Microsoft account; a restored user fails the restore check and is
logged out. On Android the Play Services check asserts only a boolean, and on
iOS the Apple Android gate is reported as skipped.

The button-behavior flow opens `auth://e2e-buttons`. Every SocialButton on that
screen has an app `onPress`, so none signs in. The flow asserts the on-screen
`gallery-probe` label after each press: a disabled button ignores presses, a
second press during a 3 second async `onPress` is ignored, a thrown
`Error("timeout")` reaches `onError` as `timeout`, the outline Microsoft button
presses, the icon-only button is 48 by 48, and the `loading` prop reaches custom
content as busy and disabled.

Provider cancellation, dispose, and silent-restore rows stay visibly pending
in the default Smoke Tests run. No replay flow presses Provider QA: on an
Android release emulator, its first provider login opened Chrome (the Chrome
first-run sheet) before the synchronous logout cancellation landed, so the
result is not deterministic. Only the signed-out dispose and logout paths in the
signed-out-extended flow are replay-asserted. The Provider QA probes accept
`cancelled` or the explicit `configuration_error` setup gate and append the code
to the `smoke-results` token for manual QA. The Provider QA action may open native
provider UI and calls the public logout path; the native adapter may sign out
its provider SDK. Use it only as an explicit run on a disposable QA session and
dedicated target with configured provider prerequisites and a cleanup plan.
Real Google, Apple, and Microsoft success, refresh, consent, Apple Android
broker, and server-side credential verification also remain pending, along
with provider logout cleanup. See
`e2e/auth-replay-coverage.json` for each acceptance row and its prerequisites.
The default replay does not prove those behaviors.

# Auth example smoke coverage

The maintained replay uses the example's installed release build. It expects
the package session to be signed out before the run. The replay checks that
precondition and stops if a user is present; it does not sign an existing user
out. It does not build the app, start Metro, or inject provider credentials.

The default replay runs every manifest suite, including `signed-out-extended`.
It covers public signed-out behavior: session getters and snapshots, lifecycle
listeners, operation event correlation, typed token and scope results,
`logout()`, an empty `silentRestore()` (a restored user is logged out and
reported as a failure), `requestScopes`, `dispose()` and recreation, the Android
Apple setup gate, `useAuth`, capability values, error mapping, and logging
controls. Provider-dependent login and credential probes stay `PENDING`. The
asserted features are listed per id in
[the replay coverage manifest](../e2e/auth-replay-coverage.json), and
[the replay guide](qa/agent-device-replay.md) describes each suite. A separate
Provider QA action can open native provider UI and is outside the default replay.

The visual button gallery is separate from authentication. Its Google and
Apple handlers only update the “Last visual button pressed” label. Image, SVG,
shape, appearance, icon-only, and loading assertions prove rendering and press
feedback only.

Google, Apple iOS, Apple Android broker, Microsoft, `loginAndGetUser`, real
refresh and deduplication, scope consent, credential server verification,
logout cleanup, silent restore, and provider cancellation acceptance remain
`PENDING` until the prerequisites in [the replay coverage manifest](../e2e/auth-replay-coverage.json)
are met. A visual press, API-name check, setup error, or cancellation does not
close those rows.

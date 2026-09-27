# Code Audit

Tick an item when it lands, and note the commit next to it.

- P0: broken today, the behaviour is wrong.
- P1: misleading today, users or contributors will get it wrong.
- P2: inconsistent with siblings or other layers, or costly to change.
- P3: polish, duplication, dead code.

Audited 2026-09-26 at `0c59c27`. Read all 194 in-scope first-party source, test, example, tooling, and guidance/configuration files in full; excluded generated files, assets, dependencies, lockfiles, and build output. Four isolated Jest probes exercised the three defects below, including an actual failed-script insertion followed by retry. Device and release gates were not run for this tracker-only audit.

## P0: Broken

- [ ] 1. **Disabling web token persistence leaves previously cached credentials in browser storage.** `loadFromCache` at `packages/react-native-nitro-auth/src/Auth.web.ts:545` strips credential fields from an in-memory clone at line 557, but does not rewrite `CACHE_KEY`; only the separate Microsoft refresh-token entry is removed at line 597. With `nitroAuthPersistTokensOnWeb: false`, a probe restores a cached user without an in-memory access token while the serialized cache still contains that token, contrary to the memory-only contract. **Extract Function** for credential sanitization and apply the current persistence policy to the stored record as well as the restored user; cover a transition from an earlier opt-in cache.
- [ ] 2. **A browser storage getter can abort Auth initialization before the fallback runs.** `packages/react-native-nitro-auth/src/Auth.web.ts:432` reads `window.localStorage` or `window.sessionStorage` before entering the `try` at line 434. A restricted-origin `SecurityError` from that property getter escapes during cache loading instead of using the advertised memory fallback. **Extract Function** for storage resolution with both property access and the read/write availability probe inside the same guarded block; test a throwing property getter.
- [ ] 3. **Retrying Apple login after a script-load failure hangs.** The rejection handler at `packages/react-native-nitro-auth/src/Auth.web.ts:1835` resets the shared promise but leaves the failed SDK script in the DOM. The next call takes the existing-script branch at line 1801 and waits for a load/error event that already occurred; that branch has no timeout or terminal-failure check. A DOM probe confirms the first login rejects and the second remains pending on the same failed element. **Extract Function** for SDK load-state handling, remove/recreate a failed script, and clean up terminal handlers so retries settle deterministically.

## Local implementation receipt — 2026-09-27

All three audit fixes are implemented in the working tree for proposed patch 0.11.3. The browser cache policy now sanitizes owned records in both local/session stores, including memory-mode opt-out; denied access/removal produces safe diagnostics. Apple script loading is shared, bounded, retryable and cancellation-aware.

- Focused RED/GREEN: initial 98-case suite plus five cross-mode/denied-store cases; final Auth.web file 103/103 passed.
- Final `bun run release:preflight`: PASS, including check:ci, format, example static gates, package audit and auth-free publish dry run. Document mirrors were synchronized after the first audit exposed stale README/CHANGELOG copies.
- Actual Auth.web bundle in isolated Chromium: six scenarios PASS with rendered terminal markers and no page errors (selected-store sanitation, both storage-mode directions, memory opt-out, denied getter, Apple retry). Configuration/provider script boundaries are fixtures; no provider login or production requests occurred.
- Android and iOS prebuild/build: PASS. Native install/launch/smoke remains pending because configured targets are unavailable and replacement targets have not been selected.
- Evidence: `/tmp/nitro-implementation.GbjgqhYj/auth-{release-preflight,browser-final,android-build,ios-build}.log`.

Original checkboxes remain open: no landing commit or complete native runtime acceptance exists. No commit, publication or provider-performance claim is made.

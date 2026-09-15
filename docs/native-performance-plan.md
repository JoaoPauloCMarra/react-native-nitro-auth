# Native architecture and performance

## Ownership

The C++ `HybridAuth` coordinator owns the in-memory session, cancellation,
refresh deduplication, credential transactions, atomic results, and session
snapshots. `AuthService` normalizes errors and isolates JavaScript listeners.
The web implementation keeps equivalent browser behavior in TypeScript.

`NativeAuthAdapter.nitro.ts` defines the internal provider boundary. Nitrogen
produces the Swift, Kotlin, JNI, and C++ bindings. `cpp/PlatformAuth.cpp` validates
typed provider results and maps failures to the canonical exception envelope.
`ios/HybridNativeAuthAdapter.swift` and Android's `HybridNativeAuthAdapter.kt`
adapt the existing platform SDK implementation. SDK UI, network operations,
secure nonce generation, and browser lifecycle remain platform-owned.

The handwritten JNI result bridge, Objective-C++ dictionary bridge, and unused
Android context cache have been removed. Swift still validates dictionaries
returned inside the existing Swift provider implementation before constructing
generated values. No dictionary crosses the C++ provider boundary.

## Implemented changes

- `getCredential()` performs one native transaction. It never publishes the
  temporary provider user as the package session. Active sessions reject with
  `invalid_state`; overlapping operations reject with `operation_in_progress`.
  Logout/disposal cancel pending work. A primary failure wins over cleanup
  failure; cleanup failure rejects an otherwise successful credential.
- `loginAndGetUser()` captures the user from its own provider completion.
  `revokeScopesWithResult()` computes the result in the same scope mutation.
  Neither helper reads a later session to assemble its result.
- `getSessionSnapshot()` returns user, scopes, and revision atomically.
  `useAuth()` shares a single snapshot subscription across mounted consumers.
  Revisions prevent stale snapshots from replacing newer state. The store
  rereads after registration to close the render-to-subscribe gap.
- Service callbacks isolate exceptions and suppress queued delivery after
  unsubscribe. Cleanup is idempotent. Snapshot observers follow service
  recreation so mounted hooks do not retain a disposed session.
- Async service calls emit `operation_started` and one terminal
  `operation_succeeded` or `operation_failed` event. IDs correlate calls;
  terminal events include elapsed milliseconds and failures include a typed
  code. No tokens, profile data, or raw provider messages enter these events.
- Provider invalidation and promise cancellation remain separate phases. The
  coordinator settles public promises with the documented cancellation code
  before the adapter drains pending provider callbacks.

## Performance claims

These changes remove JS orchestration calls and repeated hook subscriptions.
They do not establish a measured provider sign-in speedup. Auth UI and network
latency usually dominate those operations. No custom cryptography, synchronous
network calls, or token persistence was added.

Use the example E2E lookup measurement for a local diagnostic only. It measures
120 in-process API lookups and reports elapsed milliseconds, not OAuth latency.
A speed comparison requires the same release build, Hermes version, device,
provider configuration, and repeated before/after samples. Follow
[the benchmark policy](benchmarks.md).

## Verification boundaries

C++ tests cover coordinator transactions, primary/cleanup failure precedence,
missing tokens, stale completions, cancellation, snapshots, and atomic results.
JS tests cover the web implementation, service errors/events, shared hook store,
and subscription lifecycle. Native example builds compile the generated
adapter and production C++ bridge together; C++ mock tests alone do not do so.

The example's deterministic smoke run clears its local session and tests
signed-out operations, cancellation/setup errors, subscriptions, event
correlation, hook actions, and disposal/recreation. It does not authenticate
provider accounts. Successful Google, Apple, and Microsoft sign-in, consent,
refresh of real credentials, and provider revocation require configured
provider acceptance tests. See [example coverage](example-smoke-coverage.md).

## Upstream contracts

- [Nitro callbacks](https://nitro.margelo.com/docs/types/callbacks)
- [Nitro promises](https://nitro.margelo.com/docs/types/promises)
- [Nitro structs](https://nitro.margelo.com/docs/types/custom-structs)
- [Hybrid Objects](https://nitro.margelo.com/docs/concepts/hybrid-objects)

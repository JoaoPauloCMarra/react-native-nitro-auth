# Benchmarks

This package intentionally has no synthetic throughput benchmark. Sign-in
performance is dominated by the selected identity provider, browser or native
credential UI, device state, network, and server response time. A local mock
would measure only the mock and could not truthfully represent Google, Apple,
or Microsoft sign-in.

Use the package tests and platform smoke flows for deterministic correctness
coverage. Provider-specific latency should be measured in a controlled device
environment with the real provider configuration and must not be compared with
the local native benchmarks of other Nitro packages.

## Measuring package overhead

The [native performance plan](native-performance-plan.md) documents fewer native
crossings and state conversions. No before/after latency measurements exist yet.
Use two separate measurements when evaluating these changes:

1. **Package overhead:** instrument an RN/Hermes harness with a controlled
   provider adapter. Count native method/property calls, copied user/token
   payloads, listener deliveries, and React commits. Measure JS work, native
   conversion time, allocation volume, and retained listeners after cleanup.
   This measures the package boundary only, not real sign-in speed.
2. **Provider latency:** use the configured real provider on Android and iOS.
   Separate cold setup, time until UI presentation, user interaction, provider
   or broker network time, and callback-to-promise settlement. Report manual
   interaction separately from automated timings.

Record the exact commit, device/OS, build mode, Hermes/RN/Nitro versions,
provider configuration category, warm/cold state, sample count, and p50/p95.
Use monotonic clocks within each runtime; do not subtract timestamps from
different clock domains. Exclude tokens, nonce values, profile data, redirect
URLs, and response bodies from traces.

Compare cached-user reads, login-and-read, credential acquisition, concurrent
refresh, and one versus several mounted `useAuth()` consumers. Include
unsubscribe/dispose with a callback already queued, repeated mount/unmount,
offline failure, and cancellation. A reduction in crossings is useful evidence
but does not by itself prove reduced end-to-end latency.

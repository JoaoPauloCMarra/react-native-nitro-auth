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

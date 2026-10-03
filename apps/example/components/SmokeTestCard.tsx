import { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AuthError,
  AuthService,
  isAuthErrorCode,
  toAuthErrorCode,
  useAuth,
  type AuthErrorCode,
  getProviderTokenCapabilities,
  type AuthLifecycleEvent,
} from "react-native-nitro-auth";

type TestStatus = "pass" | "fail" | "skip" | "pending";

type TestResult = {
  id: string;
  name: string;
  status: TestStatus;
  detail?: string;
  outcome?: string;
};

type TestCase = {
  id: string;
  name: string;
  requiresProvider?: boolean;
  unsupportedReason?: string;
  run: () => Promise<TestResult> | TestResult;
};

class SmokeAssertionError extends Error {}

function probeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pass(
  item: Pick<TestCase, "id" | "name">,
  outcome?: string,
): TestResult {
  return outcome === undefined
    ? { id: item.id, name: item.name, status: "pass" }
    : { id: item.id, name: item.name, status: "pass", outcome };
}

function skip(item: TestCase, detail: string): TestResult {
  return { id: item.id, name: item.name, status: "skip", detail };
}

function initialResult(item: TestCase, includeProvider: boolean): TestResult {
  if (item.requiresProvider && !includeProvider) {
    return {
      id: item.id,
      name: item.name,
      status: "pending",
      detail:
        "Requires a configured provider and dedicated QA account; the default replay does not run it.",
    };
  }
  if (item.unsupportedReason) {
    return skip(item, item.unsupportedReason);
  }

  return { id: item.id, name: item.name, status: "pending" };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new SmokeAssertionError(message);
  }
}

function test(
  name: string,
  run: () => void | string | Promise<void | string>,
  requiresProvider = false,
  unsupportedReason?: string,
): TestCase {
  const item = { id: probeId(name), name, requiresProvider, unsupportedReason };
  return {
    ...item,
    run: async () => {
      try {
        const outcome = await run();
        return pass(item, typeof outcome === "string" ? outcome : undefined);
      } catch (e) {
        return {
          id: item.id,
          name: item.name,
          status: "fail",
          detail:
            e instanceof AuthError
              ? `AuthError: ${e.code}`
              : e instanceof SmokeAssertionError
                ? e.message
                : "Unexpected smoke probe failure",
        };
      }
    },
  };
}

async function expectSignedOutError(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    assert(
      error instanceof AuthError && error.code === "not_signed_in",
      "Expected typed not_signed_in",
    );
    return;
  }
  assert(false, "Expected rejection without a session");
}

async function cancelProviderOperation(
  run: () => Promise<unknown>,
): Promise<string> {
  const pending = run();
  AuthService.logout();
  const code = await pending.then(
    (): string => {
      assert(false, "Provider operation completed after cancellation");
      return "resolved";
    },
    (error: unknown): string => {
      const errorCode = error instanceof AuthError ? error.code : "unknown";
      assert(error instanceof AuthError, "Provider error must be an AuthError");
      assert(
        errorCode === "cancelled" || errorCode === "configuration_error",
        `Unexpected provider cancellation code: ${errorCode}`,
      );
      return errorCode;
    },
  );
  assert(
    AuthService.currentUser === undefined,
    "Cancelled operation published a user",
  );
  return code;
}

function buildTests(hookReturn: ReturnType<typeof useAuth>): TestCase[] {
  const localEventLimitation =
    Platform.OS === "web"
      ? "Web local scope revocation emits no session event; this event probe requires the native adapter."
      : undefined;
  return [
    test("Start from a signed-out example session", () => {
      const snapshot = AuthService.getSessionSnapshot();
      assert(
        AuthService.currentUser === undefined &&
          snapshot.user === undefined &&
          AuthService.grantedScopes.length === 0 &&
          snapshot.scopes.length === 0,
        "Replay requires an already signed-out example session",
      );
    }),
    test("Capabilities describe every provider on this platform", () => {
      const platform =
        Platform.OS === "ios"
          ? "ios"
          : Platform.OS === "android"
            ? "android"
            : "web";
      const google = getProviderTokenCapabilities("google", platform);
      const apple = getProviderTokenCapabilities("apple", platform);
      const microsoft = getProviderTokenCapabilities("microsoft", platform);
      assert(
        google.supportsAccessToken === (platform !== "android"),
        "Google access-token capability mismatch",
      );
      assert(
        google.supportsClientSideRefresh && google.supportsServerAuthCode,
        "Google refresh or server-code capability mismatch",
      );
      assert(
        apple.supportsAccessToken === false,
        "Apple unexpectedly exposes an access token",
      );
      assert(
        apple.supportsClientSideRefresh === false &&
          apple.accessTokenExpirySource === "unavailable",
        "Apple token capability mismatch",
      );
      assert(
        microsoft.supportsAccessToken && microsoft.supportsClientSideRefresh,
        "Microsoft token capability mismatch",
      );
      assert(
        microsoft.supportsServerAuthCode === false,
        "Microsoft unexpectedly exposes a server auth code",
      );
      assert(
        typeof AuthService.hasPlayServices === "boolean",
        "Invalid Play Services result",
      );
    }),
    test("Atomic snapshot agrees with legacy getters", () => {
      const snapshot = AuthService.getSessionSnapshot();
      assert(
        Number.isSafeInteger(snapshot.revision),
        "Invalid snapshot revision",
      );
      assert(
        snapshot.user === undefined && AuthService.currentUser === undefined,
        "Unexpected user",
      );
      assert(
        snapshot.scopes.length === 0 && AuthService.grantedScopes.length === 0,
        "Unexpected granted scopes",
      );
      assert(
        JSON.stringify(snapshot.scopes) ===
          JSON.stringify(AuthService.grantedScopes),
        "Scope mismatch",
      );
    }),
    test(
      "Snapshot and user events survive a throwing listener",
      async () => {
        let snapshots = 0;
        let states = 0;
        const bad = AuthService.onAuthStateChanged(() => {
          throw new Error("smoke listener");
        });
        const state = AuthService.onAuthStateChanged(() => {
          states += 1;
        });
        const snapshot = AuthService.onSessionChanged(() => {
          snapshots += 1;
        });
        try {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const initialStates = states;
          const initialSnapshots = snapshots;
          await AuthService.revokeScopes(["email"]);
          await new Promise((resolve) => setTimeout(resolve, 50));
          assert(
            states > initialStates && snapshots > initialSnapshots,
            "Session listeners did not receive the local scope update",
          );
        } finally {
          bad();
          state();
          snapshot();
        }
      },
      false,
      localEventLimitation,
    ),
    test(
      "Unsubscribe stops later callbacks and is idempotent",
      async () => {
        let calls = 0;
        let controlCalls = 0;
        const remove = AuthService.onAuthStateChanged(() => {
          calls += 1;
        });
        const control = AuthService.onAuthStateChanged(() => {
          controlCalls += 1;
        });
        try {
          await new Promise((resolve) => setTimeout(resolve, 50));
          remove();
          remove();
          const atRemoval = calls;
          const initialControlCalls = controlCalls;
          await AuthService.revokeScopes(["email"]);
          await new Promise((resolve) => setTimeout(resolve, 50));
          assert(
            controlCalls > initialControlCalls,
            "Control listener did not receive the local scope update",
          );
          assert(
            calls === atRemoval,
            "Local update callback ran after unsubscribe",
          );
          const tokens = AuthService.onTokensRefreshed(() => {
            calls += 1;
          });
          tokens();
          tokens();
        } finally {
          remove();
          control();
        }
      },
      false,
      localEventLimitation,
    ),
    test("Operation events correlate failure and omit provider details", async () => {
      const events: AuthLifecycleEvent[] = [];
      const remove = AuthService.onAuthEvent((event) => events.push(event));
      try {
        await expectSignedOutError(() => AuthService.refreshToken());
        const start = events.find(
          (event) =>
            event.type === "operation_started" &&
            event.operation === "refreshToken",
        );
        const end = events.find(
          (event) =>
            event.type === "operation_failed" &&
            event.operation === "refreshToken",
        );
        assert(
          start?.type === "operation_started" &&
            end?.type === "operation_failed",
          "Missing operation pair",
        );
        if (
          start?.type === "operation_started" &&
          end?.type === "operation_failed"
        ) {
          assert(
            start.operationId === end.operationId &&
              end.elapsedMilliseconds >= 0,
            "Invalid correlation",
          );
          assert(end.errorCode === "not_signed_in", "Incorrect failure code");
          assert(
            !("underlyingMessage" in end) && !("idToken" in end),
            "Private data in lifecycle event",
          );
        }
      } finally {
        remove();
      }
    }),
    test("Signed-out scope revoke preserves local semantics", async () => {
      await AuthService.revokeScopes(["email"]);
      const result = await AuthService.revokeScopesWithResult(["email"]);
      assert(
        result.revokedScopes.length === 0 && result.revokedAtProvider === false,
        "Invalid empty revocation result",
      );
      await expectSignedOutError(() => AuthService.revokeAccess());
    }),
    test("Signed-out access token is undefined", async () => {
      assert(
        (await AuthService.getAccessToken()) === undefined,
        "Unexpected access token",
      );
    }),
    test(
      "Silent restore handles the empty example session",
      async () => {
        assert(
          AuthService.currentUser === undefined,
          "Provider restore probe requires a signed-out package session",
        );
        try {
          await AuthService.silentRestore();
        } catch (error) {
          assert(
            error instanceof AuthError && error.code === "not_signed_in",
            "Silent restore did not return the signed-out error contract",
          );
        }
        if (AuthService.currentUser !== undefined) {
          AuthService.logout();
          assert(
            false,
            "Silent restore found a cached provider session; that success needs separate acceptance",
          );
        }
      },
      true,
    ),
    ...(["google", "apple", "microsoft"] as const).flatMap((provider) => [
      test(
        `${provider}: login cancellation or explicit setup gate`,
        () => cancelProviderOperation(() => AuthService.login(provider)),
        true,
      ),
      test(
        `${provider}: atomic login cancellation or explicit setup gate`,
        () =>
          cancelProviderOperation(() => AuthService.loginAndGetUser(provider)),
        true,
      ),
    ]),
    ...(["google", "apple"] as const).map((provider) =>
      test(
        `${provider}: credential cancellation never publishes a session`,
        () =>
          cancelProviderOperation(() => AuthService.getCredential(provider)),
        true,
      ),
    ),
    test("useAuth exposes signed-out token and revoke behavior", async () => {
      assert(
        hookReturn.user === undefined,
        "useAuth probe requires a signed-out package session",
      );
      assert(
        (await hookReturn.getAccessToken()) === undefined,
        "Hook returned a signed-out token",
      );
      await expectSignedOutError(() => hookReturn.refreshToken());
      await hookReturn.revokeScopes(["email"]);
      const result = await hookReturn.revokeScopesWithResult(["email"]);
      assert(
        result.revokedScopes.length === 0 && result.revokedAtProvider === false,
        "Hook returned revoked scopes without a session",
      );
      await expectSignedOutError(() => hookReturn.revokeAccess());
    }),
    test("All public error codes map deterministically", () => {
      const codes: AuthErrorCode[] = [
        "cancelled",
        "interaction_required",
        "timeout",
        "network_error",
        "configuration_error",
        "not_signed_in",
        "unsupported_provider",
        "invalid_state",
        "invalid_nonce",
        "token_error",
        "no_id_token",
        "parse_error",
        "refresh_failed",
        "popup_blocked",
        "operation_in_progress",
        "unknown",
      ];
      for (const code of codes)
        assert(isAuthErrorCode(code), `Invalid code: ${code}`);
      assert(
        toAuthErrorCode("token_error: invalid_grant") === "token_error",
        "Native error prefix was lost",
      );
      assert(
        AuthError.from("not_a_code").code === "unknown",
        "Unknown error mapping failed",
      );
    }),
    test("Logging can be toggled", () => {
      AuthService.setLoggingEnabled(true);
      AuthService.setLoggingEnabled(false);
    }),
    test(
      "Dispose cancels pending work and the service recreates",
      async () => {
        const pending = AuthService.getCredential("google");
        AuthService.dispose();
        await pending.then(
          () => {
            assert(false, "Disposed operation succeeded");
          },
          (error: unknown) => {
            assert(
              error instanceof AuthError && error.code === "cancelled",
              "Dispose did not cancel the pending credential request",
            );
          },
        );
        const snapshot = AuthService.getSessionSnapshot();
        assert(
          snapshot.user === undefined && snapshot.scopes.length === 0,
          "Recreated session is not empty",
        );
        assert(
          (await AuthService.getAccessToken()) === undefined,
          "Recreated adapter returned a token",
        );
      },
      true,
    ),
  ];
}

export const SmokeTestCard = memo(function SmokeTestCard() {
  const auth = useAuth();
  const tests = useMemo(() => buildTests(auth), [auth]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = useCallback(
    async (includeProvider = false) => {
      setRunning(true);
      setResults(tests.map((item) => initialResult(item, includeProvider)));

      const outcomes: TestResult[] = [];
      const precondition = tests[0];
      if (!precondition) {
        setRunning(false);
        return;
      }
      const preconditionResult = precondition.unsupportedReason
        ? skip(precondition, precondition.unsupportedReason)
        : await precondition.run();
      outcomes.push(preconditionResult);
      setResults([
        preconditionResult,
        ...tests.slice(1).map((item) => initialResult(item, includeProvider)),
      ]);
      if (preconditionResult.status !== "pass") {
        setResults([
          preconditionResult,
          ...tests.slice(1).map((item) => ({
            id: item.id,
            name: item.name,
            status: "pending" as const,
            detail:
              "Requires an already signed-out example session; no API probe was run.",
          })),
        ]);
        setRunning(false);
        return;
      }

      for (const item of tests.slice(1)) {
        const result = item.unsupportedReason
          ? skip(item, item.unsupportedReason)
          : item.requiresProvider && !includeProvider
            ? initialResult(item, false)
            : await item.run();
        outcomes.push(result);
        setResults([
          ...outcomes,
          ...tests
            .slice(outcomes.length)
            .map((next) => initialResult(next, includeProvider)),
        ]);
      }

      setRunning(false);
    },
    [tests],
  );

  const counts = useMemo(
    () =>
      results.reduce(
        (currentCounts, result) => ({
          pass: currentCounts.pass + (result.status === "pass" ? 1 : 0),
          fail: currentCounts.fail + (result.status === "fail" ? 1 : 0),
          skip: currentCounts.skip + (result.status === "skip" ? 1 : 0),
          pending:
            currentCounts.pending + (result.status === "pending" ? 1 : 0),
        }),
        { pass: 0, fail: 0, skip: 0, pending: 0 },
      ),
    [results],
  );
  const completionLabel =
    counts.fail > 0
      ? "Smoke probes: FAIL; provider acceptance: PENDING"
      : counts.skip > 0
        ? "Deterministic checks: PARTIAL; provider acceptance: PENDING"
        : "Deterministic checks: PASS; provider acceptance: PENDING";

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Smoke Tests</Text>
          <Text testID="smoke-summary" style={styles.summary}>
            {results.length === 0
              ? "Run signed-out checks; provider probes require the separate action"
              : `${running ? "Running" : completionLabel}: ${counts.pass}/${results.length} passed, ${counts.fail} failed, ${counts.pending} pending, ${counts.skip} skipped`}
          </Text>
          {counts.fail > 0 ? (
            <Text style={styles.failSummary}>{counts.fail} failed</Text>
          ) : null}
          {results.length > 0 ? (
            <View
              testID="smoke-results"
              accessible
              accessibilityLabel={results
                .map(
                  (result) =>
                    `${result.status.toUpperCase()}:${result.id}${result.outcome ? `=${result.outcome}` : ""}`,
                )
                .join(" ")}
              style={styles.resultsProbe}
            />
          ) : null}
        </View>
        <Pressable
          testID="smoke-run-all"
          accessibilityLabel="Run deterministic signed-out API checks"
          accessibilityRole="button"
          accessibilityState={{ busy: running, disabled: running }}
          style={[styles.runButton, running && styles.runButtonDisabled]}
          onPress={() => {
            void runTests(false);
          }}
          disabled={running}
        >
          {running ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.runButtonText}>
              {results.length > 0 ? "Run again" : "Run"}
            </Text>
          )}
        </Pressable>
        <Pressable
          testID="smoke-run-provider-probes"
          accessibilityLabel="Run provider-dependent probes; may open provider UI"
          accessibilityRole="button"
          accessibilityState={{ busy: running, disabled: running }}
          style={[styles.providerButton, running && styles.runButtonDisabled]}
          onPress={() => {
            void runTests(true);
          }}
          disabled={running}
        >
          <Text style={styles.runButtonText}>Provider QA</Text>
        </Pressable>
      </View>
      <Text style={styles.providerNote}>
        Provider QA may open provider UI and sign out its SDK. Use a disposable
        QA session and dedicated account.
      </Text>

      {results.map((result) => (
        <View
          key={result.name}
          style={[styles.row, result.status === "skip" && styles.rowSkipped]}
        >
          <Text style={[styles.status, statusTextStyle(result.status)]}>
            {`${result.status.toUpperCase()}:${result.id}`}
          </Text>
          <View style={styles.rowBody}>
            <Text style={styles.testName}>{result.name}</Text>
            {result.detail ? (
              <Text style={styles.detail} numberOfLines={2}>
                {result.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
});

function statusTextStyle(status: TestStatus) {
  if (status === "pass") {
    return styles.statusPass;
  }
  if (status === "fail") {
    return styles.statusFail;
  }
  if (status === "skip") {
    return styles.statusSkip;
  }
  return styles.statusPending;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e0ec",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerCopy: {
    flex: 1,
    marginRight: 12,
  },
  providerNote: {
    color: "#7c2d12",
    fontSize: 11,
    marginBottom: 8,
  },
  title: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "800",
  },
  summary: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 3,
  },
  failSummary: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  resultsProbe: { height: 1 },
  runButton: {
    alignItems: "center",
    backgroundColor: "#1d4ed8",
    borderRadius: 8,
    minHeight: 40,
    minWidth: 82,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  providerButton: {
    alignItems: "center",
    backgroundColor: "#7c2d12",
    borderRadius: 8,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  runButtonDisabled: {
    backgroundColor: "#e2e8f0",
  },
  runButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  row: {
    borderTopColor: "#e2e8f0",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingVertical: 8,
  },
  rowSkipped: {
    backgroundColor: "#f8fafc",
  },
  status: {
    fontSize: 10,
    fontWeight: "800",
    marginRight: 10,
    width: 52,
  },
  statusPass: {
    color: "#15803d",
  },
  statusFail: {
    color: "#b91c1c",
  },
  statusSkip: {
    color: "#a16207",
  },
  statusPending: {
    color: "#64748b",
  },
  rowBody: {
    flex: 1,
  },
  testName: {
    color: "#111827",
    fontSize: 13,
  },
  detail: {
    color: "#64748b",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
});

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
  name: string;
  status: TestStatus;
  detail?: string;
};

type TestCase = {
  name: string;
  unsupportedReason?: string;
  run: () => Promise<TestResult> | TestResult;
};

function pass(name: string): TestResult {
  return { name, status: "pass" };
}

function skip(name: string, detail: string): TestResult {
  return { name, status: "skip", detail };
}

function initialResult(item: TestCase): TestResult {
  if (item.unsupportedReason) {
    return skip(item.name, item.unsupportedReason);
  }

  return { name: item.name, status: "pending" };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, run: () => void | Promise<void>): TestCase {
  return {
    name,
    run: async () => {
      try {
        await run();
        return pass(name);
      } catch (e) {
        return {
          name,
          status: "fail",
          detail: e instanceof Error ? e.message : String(e),
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
  throw new Error("Expected rejection without a session");
}

async function cancelProviderOperation(run: () => Promise<unknown>) {
  const pending = run();
  AuthService.logout();
  try {
    await pending;
    throw new Error("Provider operation completed after cancellation");
  } catch (error) {
    assert(error instanceof AuthError, "Provider error must be an AuthError");
    const code = (error as AuthError).code;
    assert(
      [
        "cancelled",
        "configuration_error",
        "unsupported_provider",
        "not_signed_in",
      ].includes(code),
      `Unexpected provider cancellation code: ${code}`,
    );
  }
  assert(
    AuthService.currentUser === undefined,
    "Cancelled operation published a user",
  );
}

function buildTests(hookReturn: ReturnType<typeof useAuth>): TestCase[] {
  return [
    test("Start from a signed-out example session", () => {
      AuthService.logout();
      assert(AuthService.currentUser === undefined, "Session did not clear");
    }),
    test("Capabilities describe every provider on this platform", () => {
      const platform =
        Platform.OS === "ios"
          ? "ios"
          : Platform.OS === "android"
            ? "android"
            : "web";
      for (const provider of ["google", "apple", "microsoft"] as const) {
        const capabilities = getProviderTokenCapabilities(provider, platform);
        assert(
          typeof capabilities.supportsAccessToken === "boolean",
          "Invalid capability",
        );
      }
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
        JSON.stringify(snapshot.scopes) ===
          JSON.stringify(AuthService.grantedScopes),
        "Scope mismatch",
      );
    }),
    test("Snapshot and user events survive a throwing listener", async () => {
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
        AuthService.logout();
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert(
          states > 0 && snapshots > 0,
          "Session listeners did not receive logout",
        );
      } finally {
        bad();
        state();
        snapshot();
      }
    }),
    test("Unsubscribe suppresses queued callbacks and is idempotent", async () => {
      let calls = 0;
      const remove = AuthService.onAuthStateChanged(() => {
        calls += 1;
      });
      AuthService.logout();
      remove();
      remove();
      const atRemoval = calls;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert(calls === atRemoval, "Queued callback ran after unsubscribe");
      const tokens = AuthService.onTokensRefreshed(() => {
        calls += 1;
      });
      tokens();
      tokens();
    }),
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
    test("Scope operations preserve signed-out semantics", async () => {
      await expectSignedOutError(() => AuthService.requestScopes(["email"]));
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
    test("Silent restore handles the empty example session", async () => {
      try {
        await AuthService.silentRestore();
      } catch (error) {
        assert(
          error instanceof AuthError && error.code === "not_signed_in",
          "Unexpected restore error",
        );
      }
      assert(AuthService.currentUser === undefined, "Unexpected restored user");
    }),
    ...(["google", "apple", "microsoft"] as const).flatMap((provider) => [
      test(`${provider}: login cancellation or explicit setup gate`, () =>
        cancelProviderOperation(() => AuthService.login(provider))),
      test(`${provider}: atomic login cancellation or explicit setup gate`, () =>
        cancelProviderOperation(() => AuthService.loginAndGetUser(provider))),
    ]),
    ...(["google", "apple"] as const).map((provider) =>
      test(`${provider}: credential cancellation never publishes a session`, () =>
        cancelProviderOperation(() => AuthService.getCredential(provider))),
    ),
    test("useAuth actions expose typed signed-out behavior", async () => {
      hookReturn.logout();
      assert(
        (await hookReturn.getAccessToken()) === undefined,
        "Hook returned a signed-out token",
      );
      await expectSignedOutError(() => hookReturn.refreshToken());
      await expectSignedOutError(() => hookReturn.requestScopes(["email"]));
      await hookReturn.revokeScopes(["email"]);
      const result = await hookReturn.revokeScopesWithResult(["email"]);
      assert(
        result.revokedScopes.length === 0,
        "Hook returned revoked scopes without a session",
      );
      await expectSignedOutError(() => hookReturn.revokeAccess());
      await hookReturn.silentRestore();
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
    test("Dispose cancels pending work and the service recreates", async () => {
      const pending = AuthService.getCredential("google");
      AuthService.dispose();
      try {
        await pending;
        throw new Error("Disposed operation succeeded");
      } catch (error) {
        assert(
          error instanceof AuthError,
          "Dispose did not return a typed failure",
        );
      }
      const snapshot = AuthService.getSessionSnapshot();
      assert(
        snapshot.user === undefined && snapshot.scopes.length === 0,
        "Recreated session is not empty",
      );
      assert(
        (await AuthService.getAccessToken()) === undefined,
        "Recreated adapter returned a token",
      );
    }),
  ];
}

export const SmokeTestCard = memo(function SmokeTestCard() {
  const auth = useAuth();
  const tests = useMemo(() => buildTests(auth), [auth]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = useCallback(async () => {
    setRunning(true);
    setResults(tests.map((item) => initialResult(item)));

    const outcomes: TestResult[] = [];
    for (const item of tests) {
      const result = item.unsupportedReason
        ? skip(item.name, item.unsupportedReason)
        : await item.run();
      outcomes.push(result);
      setResults([
        ...outcomes,
        ...tests.slice(outcomes.length).map((next) => initialResult(next)),
      ]);
    }

    setRunning(false);
  }, [tests]);

  const counts = useMemo(
    () =>
      results.reduce(
        (currentCounts, result) => ({
          pass: currentCounts.pass + (result.status === "pass" ? 1 : 0),
          fail: currentCounts.fail + (result.status === "fail" ? 1 : 0),
          skip: currentCounts.skip + (result.status === "skip" ? 1 : 0),
        }),
        { pass: 0, fail: 0, skip: 0 },
      ),
    [results],
  );
  const completionLabel =
    counts.fail === 0 ? "Complete: PASS" : "Complete: FAIL";

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Smoke Tests</Text>
          <Text testID="smoke-summary" style={styles.summary}>
            {results.length === 0
              ? "Run signed-out API checks (clears example session)"
              : `${running ? "Running" : completionLabel}: ${counts.pass}/${results.length} passed, ${counts.fail} failed, ${counts.skip} skipped`}
          </Text>
          {counts.fail > 0 ? (
            <Text style={styles.failSummary}>{counts.fail} failed</Text>
          ) : null}
        </View>
        <Pressable
          testID="smoke-run-all"
          accessibilityLabel={
            results.length > 0 ? "Run smoke tests again" : "Run smoke tests"
          }
          accessibilityRole="button"
          accessibilityState={{ busy: running, disabled: running }}
          style={[styles.runButton, running && styles.runButtonDisabled]}
          onPress={runTests}
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
      </View>

      {results.map((result) => (
        <View
          key={result.name}
          style={[styles.row, result.status === "skip" && styles.rowSkipped]}
        >
          <Text style={[styles.status, statusTextStyle(result.status)]}>
            {result.status.toUpperCase()}
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
  runButton: {
    alignItems: "center",
    backgroundColor: "#1d4ed8",
    borderRadius: 8,
    minHeight: 40,
    minWidth: 82,
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

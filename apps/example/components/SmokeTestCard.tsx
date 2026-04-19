import { useCallback, useMemo, useState } from "react";
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
  type AuthProvider,
} from "react-native-nitro-auth";

type TestStatus = "pass" | "fail" | "skip" | "pending";

type TestResult = {
  name: string;
  status: TestStatus;
  detail?: string;
};

type TestCase = {
  name: string;
  run: () => Promise<TestResult> | TestResult;
};

function pass(name: string): TestResult {
  return { name, status: "pass" };
}

function skip(name: string, detail: string): TestResult {
  return { name, status: "skip", detail };
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

function buildTests(hookReturn: ReturnType<typeof useAuth>): TestCase[] {
  return [
    test("AuthService is available", () => {
      assert(AuthService != null, "AuthService is null");
    }),
    test("useAuth exposes the public API", () => {
      assert(typeof hookReturn.login === "function", "login is not a function");
      assert(
        typeof hookReturn.logout === "function",
        "logout is not a function",
      );
      assert(
        typeof hookReturn.requestScopes === "function",
        "requestScopes is not a function",
      );
      assert(
        typeof hookReturn.revokeScopes === "function",
        "revokeScopes is not a function",
      );
      assert(
        typeof hookReturn.getAccessToken === "function",
        "getAccessToken is not a function",
      );
      assert(
        typeof hookReturn.refreshToken === "function",
        "refreshToken is not a function",
      );
      assert(
        typeof hookReturn.silentRestore === "function",
        "silentRestore is not a function",
      );
      assert(typeof hookReturn.loading === "boolean", "loading is not boolean");
      assert(Array.isArray(hookReturn.scopes), "scopes is not an array");
    }),
    test("hasPlayServices returns a boolean", () => {
      assert(
        typeof AuthService.hasPlayServices === "boolean",
        "hasPlayServices is not boolean",
      );
    }),
    test("currentUser is undefined or shaped", () => {
      const user = AuthService.currentUser;
      if (!user) {
        return;
      }
      assert(
        ["google", "apple", "microsoft"].includes(user.provider),
        `unexpected provider ${user.provider}`,
      );
    }),
    test("grantedScopes returns an array", () => {
      assert(Array.isArray(AuthService.grantedScopes), "not an array");
    }),
    test("listeners return unsubscribe functions", () => {
      const unsubscribeAuth = AuthService.onAuthStateChanged(() => {});
      const unsubscribeTokens = AuthService.onTokensRefreshed(() => {});
      assert(typeof unsubscribeAuth === "function", "auth unsubscribe invalid");
      assert(
        typeof unsubscribeTokens === "function",
        "token unsubscribe invalid",
      );
      unsubscribeAuth();
      unsubscribeTokens();
    }),
    test("silentRestore resolves", async () => {
      await AuthService.silentRestore();
    }),
    test("getAccessToken resolves or returns undefined", async () => {
      const token = await AuthService.getAccessToken();
      assert(
        token === undefined || typeof token === "string",
        `expected string or undefined, got ${typeof token}`,
      );
    }),
    test("AuthError maps structured codes", () => {
      const codes: AuthErrorCode[] = [
        "cancelled",
        "timeout",
        "network_error",
        "configuration_error",
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
      for (const code of codes) {
        assert(isAuthErrorCode(code), `${code} should be valid`);
      }
      assert(
        toAuthErrorCode("token_error: invalid_grant") === "token_error",
        "prefixed native errors should map to token_error",
      );
      assert(
        AuthError.from("not_a_code").code === "unknown",
        "unknown strings should map to unknown",
      );
    }),
    test("AuthProvider union accepts supported providers", () => {
      const providers: AuthProvider[] = ["google", "apple", "microsoft"];
      assert(providers.length === 3, "expected three providers");
    }),
    {
      name: "Android Play Services is present",
      run: () => {
        if (Platform.OS !== "android") {
          return skip(
            "Android Play Services is present",
            "Only runs on Android",
          );
        }
        assert(AuthService.hasPlayServices, "Play Services unavailable");
        return pass("Android Play Services is present");
      },
    },
  ];
}

export function SmokeTestCard() {
  const auth = useAuth();
  const tests = useMemo(() => buildTests(auth), [auth]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = useCallback(async () => {
    setRunning(true);
    setResults(tests.map((item) => ({ name: item.name, status: "pending" })));

    const outcomes: TestResult[] = [];
    for (const item of tests) {
      const result = await item.run();
      outcomes.push(result);
      setResults([
        ...outcomes,
        ...tests.slice(outcomes.length).map((next) => ({
          name: next.name,
          status: "pending" as const,
        })),
      ]);
    }

    setRunning(false);
  }, [tests]);

  const passCount = results.filter((result) => result.status === "pass").length;
  const failCount = results.filter((result) => result.status === "fail").length;
  const skipCount = results.filter((result) => result.status === "skip").length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Smoke Tests</Text>
          <Text style={styles.summary}>
            {results.length === 0
              ? "Run lightweight runtime checks"
              : `${passCount}/${results.length} passed, ${skipCount} skipped`}
          </Text>
          {failCount > 0 ? (
            <Text style={styles.failSummary}>{failCount} failed</Text>
          ) : null}
        </View>
        <Pressable
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
        <View key={result.name} style={styles.row}>
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
}

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
    borderColor: "#dbe3ef",
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
    backgroundColor: "#2563eb",
    borderRadius: 8,
    minHeight: 40,
    minWidth: 82,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  runButtonDisabled: {
    opacity: 0.65,
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

import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  AuthService,
  AuthError,
  isAuthErrorCode,
  toAuthErrorCode,
  useAuth,
  type AuthProvider,
  type AuthErrorCode,
} from "react-native-nitro-auth";

type TestResult = {
  name: string;
  status: "pass" | "fail" | "skip" | "pending";
  detail?: string;
};

type TestFn = () => Promise<TestResult> | TestResult;

const test = (name: string, fn: () => void | Promise<void>): TestFn => {
  return async () => {
    try {
      await fn();
      return { name, status: "pass" };
    } catch (e) {
      return {
        name,
        status: "fail",
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  };
};

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const buildTests = (hookReturn: ReturnType<typeof useAuth>): TestFn[] => [
  test("AuthService is accessible", () => {
    assert(AuthService != null, "AuthService is null");
  }),

  test("useAuth returns expected shape", () => {
    assert(typeof hookReturn.login === "function", "login is not a function");
    assert(typeof hookReturn.logout === "function", "logout is not a function");
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
    assert(Array.isArray(hookReturn.scopes), "scopes is not array");
    assert(
      typeof hookReturn.hasPlayServices === "boolean",
      "hasPlayServices is not boolean",
    );
  }),

  test("hasPlayServices returns boolean", () => {
    const val = AuthService.hasPlayServices;
    assert(typeof val === "boolean", `expected boolean, got ${typeof val}`);
  }),

  test("currentUser is undefined when signed out", () => {
    const val = AuthService.currentUser;
    assert(val === undefined, `expected undefined, got ${typeof val}`);
  }),

  test("grantedScopes returns array", () => {
    const val = AuthService.grantedScopes;
    assert(Array.isArray(val), `expected array, got ${typeof val}`);
  }),

  test("setLoggingEnabled(true) does not throw", () => {
    AuthService.setLoggingEnabled(true);
    AuthService.setLoggingEnabled(false);
  }),

  test("onAuthStateChanged returns unsubscribe", () => {
    const unsub = AuthService.onAuthStateChanged(() => {});
    assert(typeof unsub === "function", "unsubscribe is not a function");
    unsub();
  }),

  test("onTokensRefreshed returns unsubscribe", () => {
    const unsub = AuthService.onTokensRefreshed(() => {});
    assert(typeof unsub === "function", "unsubscribe is not a function");
    unsub();
  }),

  test("logout does not throw when signed out", () => {
    AuthService.logout();
  }),

  test("silentRestore resolves", async () => {
    await AuthService.silentRestore();
  }),

  test("getAccessToken resolves", async () => {
    const token = await AuthService.getAccessToken();
    assert(
      token === undefined || typeof token === "string",
      `expected string|undefined, got ${typeof token}`,
    );
  }),

  test("AuthError.from(string) wraps correctly", () => {
    const err = AuthError.from("test error");
    assert(err instanceof AuthError, "not an AuthError instance");
    assert(err.code === "unknown", `expected 'unknown', got '${err.code}'`);
  }),

  test("AuthError.from(Error) wraps correctly", () => {
    const err = AuthError.from(new Error("native error"));
    assert(err instanceof AuthError, "not an AuthError instance");
    assert(typeof err.message === "string", "message is not string");
  }),

  test("AuthError.from(AuthError) preserves code", () => {
    const original = AuthError.from("cancelled: user cancelled");
    const rewrapped = AuthError.from(original);
    assert(rewrapped.code === original.code, "code changed after re-wrap");
  }),

  test("isAuthErrorCode validates known codes", () => {
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
      "unknown",
    ];
    for (const code of codes) {
      assert(isAuthErrorCode(code), `${code} should be valid`);
    }
    assert(!isAuthErrorCode("not_a_code"), "should reject invalid code");
  }),

  test("toAuthErrorCode maps known codes", () => {
    assert(
      toAuthErrorCode("cancelled") === "cancelled",
      "should map cancelled",
    );
    assert(
      toAuthErrorCode("garbage_value") === "unknown",
      "should fallback to unknown",
    );
  }),

  test("AuthProvider type accepts valid providers", () => {
    const providers: AuthProvider[] = ["google", "apple", "microsoft"];
    assert(providers.length === 3, "expected 3 providers");
  }),

  test("refreshToken rejects gracefully when signed out", async () => {
    try {
      await AuthService.refreshToken();
      // If it resolves, that's also fine (web mock may allow it)
    } catch (e) {
      const err = AuthError.from(e);
      assert(
        isAuthErrorCode(err.code),
        `error code is not a valid AuthErrorCode: ${err.code}`,
      );
    }
  }),

  ...(Platform.OS === "android"
    ? [
        test("hasPlayServices is true on Android emulator", () => {
          // This may fail on emulators without Play Services — mark as informational
          const val = AuthService.hasPlayServices;
          assert(val === true, "Play Services not available");
        }),
      ]
    : []),
];

export const SmokeTestCard = () => {
  const auth = useAuth();
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = useCallback(async () => {
    const tests = buildTests(auth);
    setRunning(true);
    setResults(tests.map((_) => ({ name: "", status: "pending" as const })));

    const outcomes: TestResult[] = [];
    for (const testFn of tests) {
      const result = await testFn();
      outcomes.push(result);
      setResults([...outcomes]);
    }

    setRunning(false);
  }, [auth]);

  const passCount = results.filter((r) => r.status === "pass").length;
  const failCount = results.filter((r) => r.status === "fail").length;
  const total = results.length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Smoke Tests</Text>
          {total > 0 && (
            <Text style={styles.summary}>
              {passCount}/{total} passed
              {failCount > 0 ? ` · ${failCount} failed` : ""}
            </Text>
          )}
        </View>
        <Pressable
          style={[styles.runButton, running && styles.runButtonDisabled]}
          onPress={runTests}
          disabled={running}
        >
          {running ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.runButtonText}>
              {total > 0 ? "Re-run" : "Run All"}
            </Text>
          )}
        </Pressable>
      </View>

      {results.map((r, i) =>
        r.name ? (
          <View key={i} style={styles.row}>
            <Text style={styles.indicator}>
              {r.status === "pass"
                ? "\u2713"
                : r.status === "fail"
                  ? "\u2717"
                  : "\u2022"}
            </Text>
            <View style={styles.rowContent}>
              <Text
                style={[
                  styles.testName,
                  r.status === "fail" && styles.testNameFail,
                ]}
              >
                {r.name}
              </Text>
              {r.detail ? (
                <Text style={styles.detail} numberOfLines={2}>
                  {r.detail}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null,
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    boxShadow: "0 12px 26px rgba(15, 23, 42, 0.08)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  summary: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  runButton: {
    backgroundColor: "#4285F4",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 80,
    alignItems: "center",
  },
  runButtonDisabled: {
    opacity: 0.6,
  },
  runButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
  },
  indicator: {
    width: 20,
    fontSize: 14,
    fontWeight: "700",
    color: "#16a34a",
    marginTop: 1,
  },
  rowContent: {
    flex: 1,
  },
  testName: {
    fontSize: 13,
    color: "#0f172a",
  },
  testNameFail: {
    color: "#b91c1c",
  },
  detail: {
    fontSize: 11,
    color: "#dc2626",
    marginTop: 2,
  },
});

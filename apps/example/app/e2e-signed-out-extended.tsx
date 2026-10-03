import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  AuthError,
  AuthService,
  toAuthErrorCode,
  type AuthLifecycleEvent,
  type AuthPlatform,
} from "react-native-nitro-auth";
import { authErrorCode } from "../components/e2e-auth-checks";

const NATIVE_TIMEOUT_MS = 10000;
const EVENT_TIMEOUT_MS = 1000;

const CHECK_NAMES = [
  "credential-in-progress",
  "error-envelope",
  "play-services",
  "silent-restore",
  "logout",
  "requestScopes",
  "apple-android-gate",
  "dispose-pending",
  "dispose",
] as const;

type CheckName = (typeof CHECK_NAMES)[number];
type CheckTokens = Record<CheckName, string>;

function currentPlatform(): AuthPlatform {
  if (
    Platform.OS === "ios" ||
    Platform.OS === "android" ||
    Platform.OS === "web"
  ) {
    return Platform.OS;
  }
  return "web";
}

function initialTokens(): CheckTokens {
  const tokens = {} as CheckTokens;
  for (const name of CHECK_NAMES) tokens[name] = `running:${name}`;
  return tokens;
}

type Settled<T> =
  | { kind: "resolved"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "timeout" };

function settleWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<Settled<T>> {
  return Promise.race([
    promise.then(
      (value): Settled<T> => ({ kind: "resolved", value }),
      (error: unknown): Settled<T> => ({ kind: "rejected", error }),
    ),
    new Promise<Settled<T>>((resolve) => {
      setTimeout(() => {
        resolve({ kind: "timeout" });
      }, milliseconds);
    }),
  ]);
}

async function waitUntil(
  condition: () => boolean,
  milliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

function settledCode(result: Settled<unknown>): string {
  if (result.kind === "timeout") return "timeout";
  if (result.kind === "resolved") return "resolved";
  return authErrorCode(result.error);
}

function sessionIsEmpty(): boolean {
  const snapshot = AuthService.getSessionSnapshot();
  return (
    snapshot.user === undefined &&
    snapshot.scopes.length === 0 &&
    AuthService.currentUser === undefined &&
    AuthService.grantedScopes.length === 0
  );
}

async function checkCredentialInProgress(): Promise<string> {
  const p = AuthService.getAccessToken();
  const credential = await settleWithin(
    AuthService.getCredential("google"),
    NATIVE_TIMEOUT_MS,
  );
  await settleWithin(p, NATIVE_TIMEOUT_MS);
  if (credential.kind !== "rejected") {
    return `fail:credential-in-progress=${credential.kind}`;
  }
  const error = credential.error;
  if (
    error instanceof AuthError &&
    error.code === "operation_in_progress" &&
    error.operation === "getCredential"
  ) {
    return "ok:credential-in-progress=operation_in_progress:op=getCredential";
  }
  const operation =
    error instanceof AuthError ? (error.operation ?? "none") : "none";
  return `fail:credential-in-progress=${authErrorCode(error)}:op=${operation}`;
}

function checkErrorEnvelope(): string {
  const structured = AuthError.from(
    { code: "timeout", underlyingMessage: "x" },
    "login",
  );
  const structuredMatches =
    structured.code === "timeout" &&
    structured.operation === "login" &&
    structured.message === "timeout" &&
    structured.underlyingMessage === "x";
  const legacyMatches = [
    toAuthErrorCode("no_window") === "configuration_error",
    toAuthErrorCode("disposed") === "cancelled",
  ].filter(Boolean).length;
  const prefixMatches = toAuthErrorCode("disposed: x") === "cancelled";
  const errWithOp = new AuthError("timeout", "login");
  const identityMatches =
    AuthError.from(errWithOp) === errWithOp &&
    AuthError.from(errWithOp, "logout") === errWithOp &&
    errWithOp.name === "AuthError" &&
    structured.name === "AuthError";
  if (structuredMatches && legacyMatches === 2 && prefixMatches) {
    if (identityMatches) {
      return "ok:error-envelope=structured:legacy=2:prefix:identity";
    }
  }
  return `fail:error-envelope=structured-${structuredMatches}:legacy=${legacyMatches}:prefix-${prefixMatches}:identity-${identityMatches}`;
}

function checkPlayServices(platform: AuthPlatform): string {
  const value: unknown = AuthService.hasPlayServices;
  if (typeof value !== "boolean") {
    return `fail:play-services=not-boolean:platform=${platform}`;
  }
  if (platform === "ios" && value !== true) {
    return `fail:play-services=${value}:platform=${platform}`;
  }
  return `ok:play-services=${value}:platform=${platform}`;
}

async function checkSilentRestore(): Promise<string> {
  const result = await settleWithin(
    AuthService.silentRestore(),
    NATIVE_TIMEOUT_MS,
  );
  if (AuthService.currentUser !== undefined) {
    AuthService.logout();
    return "fail:silent-restore=restored";
  }
  const code = settledCode(result);
  if (code === "resolved" || code === "not_signed_in") {
    return "ok:silent-restore=no-session";
  }
  return `fail:silent-restore=${code}`;
}

async function checkSignedOutLogout(): Promise<string> {
  const events: AuthLifecycleEvent[] = [];
  const remove = AuthService.onAuthEvent((event) => {
    events.push(event);
  });
  AuthService.logout();
  const logoutEvent = await waitUntil(
    () => events.some((event) => event.type === "logout"),
    EVENT_TIMEOUT_MS,
  );
  remove();
  const empty = sessionIsEmpty();
  if (logoutEvent && empty) {
    return "ok:logout=event:snapshot=empty";
  }
  return `fail:logout=event-${logoutEvent}:snapshot-empty-${empty}`;
}

async function checkSignedOutRequestScopes(): Promise<string> {
  const result = await settleWithin(
    AuthService.requestScopes(["email"]),
    NATIVE_TIMEOUT_MS,
  );
  const userNone =
    AuthService.currentUser === undefined &&
    AuthService.getSessionSnapshot().user === undefined;
  if (!userNone) AuthService.logout();
  const code = settledCode(result);
  if (code === "not_signed_in" && userNone) {
    return "ok:requestScopes=not_signed_in:user=none";
  }
  return `fail:requestScopes=${code}:user=${userNone ? "none" : "present"}`;
}

async function checkAppleAndroidSetupGate(
  platform: AuthPlatform,
): Promise<string> {
  if (platform !== "android") {
    return `ok:apple-android-gate=skipped:platform=${platform}`;
  }
  const result = await settleWithin(
    AuthService.login("apple"),
    NATIVE_TIMEOUT_MS,
  );
  if (AuthService.currentUser !== undefined) {
    AuthService.logout();
    return "fail:apple-android-gate=signed-in:platform=android";
  }
  const code = settledCode(result);
  if (code === "configuration_error") {
    return "ok:apple-android-gate=configuration_error:platform=android";
  }
  return `fail:apple-android-gate=${code}:platform=android`;
}

async function checkDisposePendingEvent(): Promise<string> {
  const events: AuthLifecycleEvent[] = [];
  AuthService.onAuthEvent((event) => {
    events.push(event);
  });
  const pending = AuthService.getAccessToken();
  AuthService.dispose();
  await settleWithin(pending, NATIVE_TIMEOUT_MS);
  const started = events.find(
    (event) =>
      event.type === "operation_started" &&
      event.operation === "getAccessToken",
  );
  const failed = events.find(
    (event) =>
      event.type === "operation_failed" && event.operation === "getAccessToken",
  );
  const cancelledEvent =
    started?.type === "operation_started" &&
    failed?.type === "operation_failed" &&
    failed.errorCode === "cancelled" &&
    failed.operationId === started.operationId;
  const disposeEvent = events.some((event) => event.type === "dispose");
  if (cancelledEvent && disposeEvent) {
    return "ok:dispose-pending=cancelled-event:dispose-event";
  }
  const code = failed?.type === "operation_failed" ? failed.errorCode : "none";
  return `fail:dispose-pending=failed-${code}:dispose-event-${disposeEvent}`;
}

async function checkDisposeRecreate(): Promise<string> {
  const revisionBefore = AuthService.getSessionSnapshot().revision;
  let preDisposeCalls = 0;
  AuthService.onAuthEvent(() => {
    preDisposeCalls += 1;
  });
  AuthService.dispose();
  const callsAtDispose = preDisposeCalls;
  const snapshot = AuthService.getSessionSnapshot();
  const revisionAdvanced = snapshot.revision > revisionBefore;
  const empty = sessionIsEmpty();
  let postDisposeCalls = 0;
  const remove = AuthService.onAuthEvent(() => {
    postDisposeCalls += 1;
  });
  const token = await settleWithin(
    AuthService.getAccessToken(),
    NATIVE_TIMEOUT_MS,
  );
  remove();
  const tokenUndefined = token.kind === "resolved" && token.value === undefined;
  const listenersDetached = preDisposeCalls === callsAtDispose;
  const subscriptionWorks = postDisposeCalls >= 2;
  if (
    revisionAdvanced &&
    empty &&
    listenersDetached &&
    subscriptionWorks &&
    tokenUndefined
  ) {
    return "ok:dispose=recreated:revision-advanced:listeners-detached:token=undefined";
  }
  return `fail:dispose=revision-${revisionAdvanced}:empty-${empty}:detached-${listenersDetached}:subscription-${subscriptionWorks}:token-${tokenUndefined ? "undefined" : settledCode(token)}`;
}

async function runExtendedSweep(
  publish: (name: CheckName, token: string) => void,
): Promise<void> {
  const platform = currentPlatform();
  if (!sessionIsEmpty()) {
    for (const name of CHECK_NAMES) {
      publish(name, `fail:${name}=requires-signed-out-session`);
    }
    return;
  }
  const checks: [CheckName, () => string | Promise<string>][] = [
    ["credential-in-progress", checkCredentialInProgress],
    ["error-envelope", checkErrorEnvelope],
    ["play-services", () => checkPlayServices(platform)],
    ["silent-restore", checkSilentRestore],
    ["logout", checkSignedOutLogout],
    ["requestScopes", checkSignedOutRequestScopes],
    ["apple-android-gate", () => checkAppleAndroidSetupGate(platform)],
    ["dispose-pending", checkDisposePendingEvent],
    ["dispose", checkDisposeRecreate],
  ];
  for (const [name, check] of checks) {
    let token: string;
    try {
      token = await check();
    } catch (error) {
      token = `fail:${name}=threw-${authErrorCode(error)}`;
    }
    publish(name, token);
  }
}

export default function SignedOutExtendedScreen() {
  const [tokens, setTokens] = useState<CheckTokens>(initialTokens);

  useEffect(() => {
    let active = true;
    void runExtendedSweep((name, token) => {
      if (!active) return;
      setTokens((current) => ({ ...current, [name]: token }));
    });
    return () => {
      active = false;
    };
  }, []);

  const values = CHECK_NAMES.map((name) => tokens[name]);

  return (
    <View
      testID="e2e-ext-screen"
      style={styles.screen}
      accessibilityLabel="Signed-out extended lab"
    >
      <View
        testID="e2e-ext-results"
        accessible
        accessibilityLabel={values.join(" ")}
        style={styles.resultsProbe}
      />
      <Text style={styles.title}>Signed-out extended lab</Text>
      <Text style={styles.subtitle}>
        Auto-runs signed-out guard, error, restore, logout, scope, setup-gate,
        and dispose checks on a disposable QA target. It calls native logout and
        dispose. No provider credentials or token values are rendered.
      </Text>
      <Text style={styles.result}>auth://e2e-signed-out-extended</Text>
      {values.map((value, index) => (
        <Text key={CHECK_NAMES[index]} style={styles.result}>
          {value}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#f8fafc",
    flex: 1,
    gap: 8,
    paddingBottom: 40,
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  resultsProbe: { height: 1 },
  title: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#475569",
    fontSize: 13,
  },
  result: {
    color: "#0f172a",
    fontFamily: "Menlo",
    fontSize: 11,
  },
});

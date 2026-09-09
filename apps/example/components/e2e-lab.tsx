import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthError,
  AuthService,
  getProviderTokenCapabilities,
  type AuthPlatform,
} from "react-native-nitro-auth";

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

export function AuthE2eLab() {
  const [capabilities, setCapabilities] = useState("(idle)");
  const [events, setEvents] = useState("(idle)");
  const [apiStatus, setApiStatus] = useState("(idle)");
  const [sessionAction, setSessionAction] = useState("(idle)");
  const [stressStatus, setStressStatus] = useState("(idle)");
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    const unsubscribe = AuthService.onAuthEvent(() => {
      setEventCount((count) => count + 1);
    });
    return unsubscribe;
  }, []);

  return (
    <View testID="e2e-lab" style={styles.lab} accessibilityLabel="E2E Lab">
      <Text style={styles.title}>E2E Lab</Text>
      <Text style={styles.subtitle}>
        Signed-out public API checks. Real OAuth buttons are never tapped by
        automation.
      </Text>
      <Text testID="e2e-ready" style={styles.result}>
        e2e-ready
      </Text>
      <Text testID="e2e-deeplink" style={styles.result}>
        auth://e2e
      </Text>
      <Text testID="e2e-session-state" style={styles.result}>
        {AuthService.currentUser ? "signed-in" : "signed-out"}
      </Text>
      <Text testID="e2e-capabilities" style={styles.result}>
        {capabilities}
      </Text>
      <Text testID="e2e-events" style={styles.result}>
        {events}
      </Text>
      <Text testID="e2e-api-status" style={styles.result}>
        {apiStatus}
      </Text>
      <Text testID="e2e-session-action" style={styles.result}>
        {sessionAction}
      </Text>
      <Text testID="e2e-stress-result" style={styles.result}>
        {stressStatus}
      </Text>

      <View style={styles.row}>
        <LabButton
          testID="e2e-capabilities-run"
          label="Capabilities"
          onPress={() => {
            const platform = currentPlatform();
            const google = getProviderTokenCapabilities("google", platform);
            const apple = getProviderTokenCapabilities("apple", platform);
            const microsoft = getProviderTokenCapabilities(
              "microsoft",
              platform,
            );
            setCapabilities(
              `ok:${platform}:g=${google.supportsAccessToken ? 1 : 0}:a=${apple.supportsAccessToken ? 1 : 0}:m=${microsoft.supportsAccessToken ? 1 : 0}`,
            );
          }}
        />
        <LabButton
          testID="e2e-events-run"
          label="Events"
          onPress={() => {
            setEvents(`ok:count=${eventCount}`);
          }}
        />
        <LabButton
          testID="e2e-api-run"
          label="API surface"
          onPress={() => {
            setApiStatus(
              `ok:loginAndGetUser=${typeof AuthService.loginAndGetUser}:revokeResult=${typeof AuthService.revokeScopesWithResult}:play=${String(AuthService.hasPlayServices)}`,
            );
          }}
        />
        <LabButton
          testID="e2e-silent-restore"
          label="Silent restore"
          onPress={() => {
            if (AuthService.currentUser) {
              setSessionAction("fail:expected-signed-out");
              return;
            }
            void AuthService.silentRestore()
              .then(() => {
                setSessionAction(
                  AuthService.currentUser
                    ? "fail:silent=unexpected-user"
                    : "ok:silent=signed-out",
                );
              })
              .catch((error: unknown) => {
                const code =
                  error instanceof AuthError ? error.code : "unknown";
                setSessionAction(
                  code === "not_signed_in"
                    ? "ok:silent=signed-out"
                    : `fail:silent=${code}`,
                );
              });
          }}
        />
        <LabButton
          testID="e2e-get-token"
          label="Get token"
          onPress={() => {
            if (AuthService.currentUser) {
              setSessionAction("fail:expected-signed-out");
              return;
            }
            void AuthService.getAccessToken()
              .then((token) => {
                setSessionAction(
                  token ? "fail:token=unexpected" : "ok:token=none",
                );
              })
              .catch((error: unknown) => {
                const code =
                  error instanceof AuthError ? error.code : "unknown";
                setSessionAction(
                  code === "not_signed_in"
                    ? "ok:token=none"
                    : `fail:token=${code}`,
                );
              });
          }}
        />
        <LabButton
          testID="e2e-run-stress"
          label="Stress capabilities"
          onPress={() => {
            const platform = currentPlatform();
            const started = globalThis.performance?.now?.() ?? Date.now();
            for (let index = 0; index < 40; index += 1) {
              getProviderTokenCapabilities("google", platform);
              getProviderTokenCapabilities("apple", platform);
              getProviderTokenCapabilities("microsoft", platform);
            }
            const elapsed =
              (globalThis.performance?.now?.() ?? Date.now()) - started;
            setStressStatus(`ok:lookups=120:ms=${elapsed.toFixed(1)}`);
          }}
        />
      </View>
    </View>
  );
}

function LabButton({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lab: {
    backgroundColor: "#f8fafc",
    borderColor: "#dbe5ef",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    marginBottom: 16,
    padding: 16,
  },
  title: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#475569",
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "600",
  },
  result: {
    color: "#0f172a",
    fontFamily: "Menlo",
    fontSize: 11,
  },
});

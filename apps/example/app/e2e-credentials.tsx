import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthService,
  getProviderTokenCapabilities,
  type Auth,
  type AuthPlatform,
} from "react-native-nitro-auth";
import { NitroModules } from "react-native-nitro-modules";

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

export default function CredentialsLabScreen() {
  const [nonceStatus, setNonceStatus] = useState("(idle)");
  const [capabilityStatus, setCapabilityStatus] = useState("(idle)");
  const [snapshotStatus, setSnapshotStatus] = useState("(idle)");

  return (
    <View
      testID="e2e-credentials-screen"
      style={styles.screen}
      accessibilityLabel="Credentials lab"
    >
      <Text style={styles.title}>Credentials lab</Text>
      <Text style={styles.subtitle}>
        Snapshot-safe nonce, capability, and session APIs. Live identity
        provider buttons are never shown here.
      </Text>
      <Text testID="e2e-credentials-ready" style={styles.result}>
        e2e-ready
      </Text>
      <Text testID="e2e-credentials-deeplink" style={styles.result}>
        auth://e2e-credentials
      </Text>
      <Text testID="e2e-credentials-nonce" style={styles.result}>
        {nonceStatus}
      </Text>
      <Text testID="e2e-credentials-capabilities" style={styles.result}>
        {capabilityStatus}
      </Text>
      <Text testID="e2e-credentials-snapshot" style={styles.result}>
        {snapshotStatus}
      </Text>

      <View style={styles.row}>
        <LabButton
          testID="e2e-credentials-nonce-run"
          label="Create nonce"
          onPress={() => {
            void NitroModules.createHybridObject<Auth>("Auth")
              .createNonce()
              .then((nonce) => {
                setNonceStatus(
                  `ok:raw=${nonce.raw.length}:hashed=${nonce.hashed.length}`,
                );
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof Error ? error.message : String(error);
                setNonceStatus(`fail:${message}`);
              });
          }}
        />
        <LabButton
          testID="e2e-credentials-capabilities-run"
          label="Capabilities"
          onPress={() => {
            const platform = currentPlatform();
            const google = getProviderTokenCapabilities("google", platform);
            const apple = getProviderTokenCapabilities("apple", platform);
            const microsoft = getProviderTokenCapabilities(
              "microsoft",
              platform,
            );
            setCapabilityStatus(
              `ok:${platform}:g=${google.supportsAccessToken ? 1 : 0}:a=${apple.supportsAccessToken ? 1 : 0}:m=${microsoft.supportsAccessToken ? 1 : 0}`,
            );
          }}
        />
        <LabButton
          testID="e2e-credentials-snapshot-run"
          label="Snapshot"
          onPress={() => {
            const snapshot = AuthService.getSessionSnapshot();
            setSnapshotStatus(
              `ok:rev=${snapshot.revision}:user=${snapshot.user ? "present" : "none"}:scopes=${snapshot.scopes.length}`,
            );
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
  screen: {
    backgroundColor: "#f8fafc",
    flex: 1,
    gap: 8,
    paddingBottom: 40,
    paddingHorizontal: 16,
    paddingTop: 48,
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

import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthService,
  type Auth,
  type AuthPlatform,
} from "react-native-nitro-auth";
import { NitroModules } from "react-native-nitro-modules";
import {
  authErrorCode,
  capabilityMatrixMatches,
} from "../components/e2e-auth-checks";

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

async function runCredentialsSweep(): Promise<{
  nonce: string;
  capabilities: string;
  snapshot: string;
}> {
  const platform = currentPlatform();
  let nonce = "pending:nonce=native-platform-required";
  if (platform !== "web") {
    nonce = "fail:nonce-shape";
    try {
      const nonceValue =
        await NitroModules.createHybridObject<Auth>("Auth").createNonce();
      const rawNonceValid =
        nonceValue.raw.length === 43 &&
        /^[A-Za-z0-9_-]{43}$/.test(nonceValue.raw);
      const hashedNonceValid =
        nonceValue.hashed.length === 64 &&
        /^[a-f0-9]{64}$/.test(nonceValue.hashed);
      nonce =
        rawNonceValid &&
        hashedNonceValid &&
        nonceValue.raw !== nonceValue.hashed
          ? "ok:nonce=raw-base64url-43:hashed-sha256-hex-64"
          : "fail:nonce-shape=invalid";
    } catch (error) {
      nonce = `fail:nonce=${authErrorCode(error)}`;
    }
  }

  const capabilities = capabilityMatrixMatches(platform)
    ? `ok:provider-capability-matrix=match:${platform}`
    : `fail:provider-capability-matrix=mismatch:${platform}`;

  const session = AuthService.getSessionSnapshot();
  const scopes = AuthService.grantedScopes;
  const sessionMatches =
    Number.isSafeInteger(session.revision) &&
    session.revision >= 0 &&
    session.user === undefined &&
    AuthService.currentUser === undefined &&
    session.scopes.length === 0 &&
    scopes.length === 0 &&
    JSON.stringify(session.scopes) === JSON.stringify(scopes);
  const snapshot = sessionMatches
    ? "ok:session=user=none:scopes=0:revision=safe-integer"
    : "fail:session=requires-signed-out-coherent-snapshot";

  return { nonce, capabilities, snapshot };
}

export default function CredentialsLabScreen() {
  const [nonceStatus, setNonceStatus] = useState("running");
  const [capabilityStatus, setCapabilityStatus] = useState("running");
  const [snapshotStatus, setSnapshotStatus] = useState("running");

  useEffect(() => {
    void runCredentialsSweep()
      .then((results) => {
        setNonceStatus(results.nonce);
        setCapabilityStatus(results.capabilities);
        setSnapshotStatus(results.snapshot);
      })
      .catch((error: unknown) => {
        const failure = `fail:sweep=${authErrorCode(error)}`;
        setNonceStatus(failure);
        setCapabilityStatus(failure);
        setSnapshotStatus(failure);
      });
  }, []);

  return (
    <View
      testID="e2e-credentials-screen"
      style={styles.screen}
      accessibilityLabel="Credentials lab"
    >
      <Text style={styles.title}>Credentials lab</Text>
      <Text style={styles.subtitle}>
        Auto-runs only nonce shape, provider capability, and signed-out snapshot
        checks. The native nonce check remains pending on web. No provider
        credentials or token values are rendered.
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
          label="Re-run all"
          onPress={() => {
            setNonceStatus("running");
            setCapabilityStatus("running");
            setSnapshotStatus("running");
            void runCredentialsSweep()
              .then((results) => {
                setNonceStatus(results.nonce);
                setCapabilityStatus(results.capabilities);
                setSnapshotStatus(results.snapshot);
              })
              .catch((error: unknown) => {
                const failure = `fail:sweep=${authErrorCode(error)}`;
                setNonceStatus(failure);
                setCapabilityStatus(failure);
                setSnapshotStatus(failure);
              });
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

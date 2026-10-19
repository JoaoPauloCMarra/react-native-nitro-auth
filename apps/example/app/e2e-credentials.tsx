import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AuthService } from "react-native-nitro-auth";
import {
  authErrorCode,
  capabilityMatrixMatches,
  currentPlatform,
} from "../components/e2e-auth-checks";
import {
  LabButton,
  LabResult,
  LabRow,
  LabSubtitle,
  LabTitle,
} from "../components/e2e-lab-ui";

async function runCredentialsSweep(): Promise<{
  nonce: string;
  capabilities: string;
  snapshot: string;
}> {
  const platform = currentPlatform();
  let nonce = "fail:nonce-shape";
  try {
    const nonceValue = await AuthService.createNonce();
    const rawNonceValid =
      nonceValue.raw.length === 43 &&
      /^[A-Za-z0-9_-]{43}$/.test(nonceValue.raw);
    const hashedNonceValid =
      nonceValue.hashed.length === 64 &&
      /^[a-f0-9]{64}$/.test(nonceValue.hashed);
    nonce =
      rawNonceValid && hashedNonceValid && nonceValue.raw !== nonceValue.hashed
        ? "ok:nonce=raw-base64url-43:hashed-sha256-hex-64"
        : "fail:nonce-shape=invalid";
  } catch (error) {
    nonce = `fail:nonce=${authErrorCode(error)}`;
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

  const applySweep = () => {
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
  };

  useEffect(applySweep, []);

  return (
    <View
      testID="e2e-credentials-screen"
      style={styles.screen}
      accessibilityLabel="Credentials lab"
    >
      <LabTitle>Credentials lab</LabTitle>
      <LabSubtitle>
        Auto-runs only nonce shape, provider capability, and signed-out snapshot
        checks. No provider credentials or token values are rendered.
      </LabSubtitle>
      <LabResult testID="e2e-credentials-ready">e2e-ready</LabResult>
      <LabResult testID="e2e-credentials-deeplink">
        auth://e2e-credentials
      </LabResult>
      <LabResult testID="e2e-credentials-nonce">{nonceStatus}</LabResult>
      <LabResult testID="e2e-credentials-capabilities">
        {capabilityStatus}
      </LabResult>
      <LabResult testID="e2e-credentials-snapshot">{snapshotStatus}</LabResult>

      <LabRow>
        <LabButton
          testID="e2e-credentials-nonce-run"
          label="Re-run all"
          onPress={() => {
            setNonceStatus("running");
            setCapabilityStatus("running");
            setSnapshotStatus("running");
            applySweep();
          }}
        />
      </LabRow>
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
});

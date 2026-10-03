import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AuthService, type AuthPlatform } from "react-native-nitro-auth";
import { authErrorCode, capabilityMatrixMatches } from "./e2e-auth-checks";

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

async function signedOutScopeContract(): Promise<string> {
  if (AuthService.currentUser !== undefined) {
    return "fail:scope-contract=session-not-signed-out";
  }

  await AuthService.revokeScopes(["email"]);
  const revocation = await AuthService.revokeScopesWithResult(["email"]);
  if (
    revocation.revokedScopes.length !== 0 ||
    revocation.revokedAtProvider !== false
  ) {
    return "fail:scope-contract=unexpected-revocation";
  }

  let revokeAccessCode = "resolved";
  try {
    await AuthService.revokeAccess();
  } catch (error) {
    revokeAccessCode = authErrorCode(error);
  }
  if (revokeAccessCode !== "not_signed_in") {
    return `fail:scope-contract=revoke-access-${revokeAccessCode}`;
  }

  return "ok:revokeScopes=resolved:revokedScopes=0:revokedAtProvider=false:revokeAccess=not_signed_in";
}

export function AuthE2eLab() {
  const [capabilities, setCapabilities] = useState("(idle)");
  const [events, setEvents] = useState("(idle)");
  const [apiStatus, setApiStatus] = useState("(idle)");
  const [sessionAction, setSessionAction] = useState("(idle)");
  const [scopeStatus, setScopeStatus] = useState("(idle)");
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
        The default replay requires an already signed-out package session and
        never starts provider login or restore. The manual restore control may
        find an existing provider session.
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
      <Text testID="e2e-scopes-status" style={styles.result}>
        {scopeStatus}
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
            setCapabilities(
              capabilityMatrixMatches(platform)
                ? `ok:provider-capability-matrix=match:${platform}`
                : `fail:provider-capability-matrix=mismatch:${platform}`,
            );
          }}
        />
        <LabButton
          testID="e2e-events-run"
          label="Events"
          onPress={() => {
            setEvents(
              eventCount > 0
                ? `ok:auth-event-listener=received:${eventCount}`
                : "fail:auth-event-listener=empty",
            );
          }}
        />
        <LabButton
          testID="e2e-api-run"
          label="Session snapshot"
          onPress={() => {
            const snapshot = AuthService.getSessionSnapshot();
            const currentUser = AuthService.currentUser;
            const grantedScopes = AuthService.grantedScopes;
            const consistent =
              Number.isSafeInteger(snapshot.revision) &&
              snapshot.revision >= 0 &&
              snapshot.user === currentUser &&
              JSON.stringify(snapshot.scopes) === JSON.stringify(grantedScopes);
            if (!consistent) {
              setApiStatus("fail:session-snapshot=legacy-getter-mismatch");
              return;
            }
            setApiStatus(
              `ok:session=user=${snapshot.user ? "present" : "none"}:scopes=${snapshot.scopes.length}:revision=${snapshot.revision}:play-services=${AuthService.hasPlayServices ? "available" : "unavailable"}`,
            );
          }}
        />
        <LabButton
          testID="e2e-silent-restore"
          label="Manual provider silent restore"
          onPress={() => {
            if (AuthService.currentUser) {
              setSessionAction("fail:silent-restore=requires-signed-out");
              return;
            }
            void AuthService.silentRestore()
              .then(() => {
                setSessionAction(
                  AuthService.currentUser
                    ? "pending:silent-restore=provider-session-restored"
                    : "ok:silent-restore=empty",
                );
              })
              .catch((error: unknown) => {
                const code = authErrorCode(error);
                setSessionAction(
                  code === "not_signed_in"
                    ? "ok:silent-restore=not-signed-in"
                    : `pending:silent-restore=provider-error:${code}`,
                );
              });
          }}
        />
        <LabButton
          testID="e2e-get-token"
          label="Signed-out access token"
          onPress={() => {
            if (AuthService.currentUser) {
              setSessionAction("fail:access-token=requires-signed-out");
              return;
            }
            void AuthService.getAccessToken()
              .then((token) => {
                setSessionAction(
                  token === undefined
                    ? "ok:access-token=undefined"
                    : "fail:access-token=returned",
                );
              })
              .catch((error: unknown) => {
                setSessionAction(`fail:access-token=${authErrorCode(error)}`);
              });
          }}
        />
        <LabButton
          testID="e2e-scopes-run"
          label="Signed-out revoke contract"
          onPress={() => {
            setScopeStatus("running");
            void signedOutScopeContract()
              .then(setScopeStatus)
              .catch((error: unknown) => {
                setScopeStatus(`fail:scope-contract=${authErrorCode(error)}`);
              });
          }}
        />
        <LabButton
          testID="e2e-run-stress"
          label="Repeat capability checks"
          onPress={() => {
            const platform = currentPlatform();
            let matches = true;
            for (let index = 0; index < 40; index += 1) {
              if (!capabilityMatrixMatches(platform)) {
                matches = false;
                break;
              }
            }
            setStressStatus(
              matches
                ? "ok:provider-capability-matrix-repeat=40"
                : "fail:provider-capability-matrix-repeat=mismatch",
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

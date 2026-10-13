import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { AuthService } from "react-native-nitro-auth";
import {
  authErrorCode,
  capabilityMatrixMatches,
  currentPlatform,
} from "./e2e-auth-checks";
import { LabButton, labStyles } from "./e2e-lab-ui";

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
      <Text style={labStyles.title}>E2E Lab</Text>
      <Text style={labStyles.subtitle}>
        This lab requires an already signed-out package session and its replay
        never starts provider login or restore. The manual restore control may
        find an existing provider session.
      </Text>
      <Text testID="e2e-ready" style={labStyles.result}>
        e2e-ready
      </Text>
      <Text testID="e2e-deeplink" style={labStyles.result}>
        auth://e2e
      </Text>
      <Text testID="e2e-session-state" style={labStyles.result}>
        {AuthService.currentUser ? "session=signed-in" : "session=signed-out"}
      </Text>
      <Text testID="e2e-capabilities" style={labStyles.result}>
        {capabilities}
      </Text>
      <Text testID="e2e-events" style={labStyles.result}>
        {events}
      </Text>
      <Text testID="e2e-api-status" style={labStyles.result}>
        {apiStatus}
      </Text>
      <Text testID="e2e-session-action" style={labStyles.result}>
        {sessionAction}
      </Text>
      <Text testID="e2e-scopes-status" style={labStyles.result}>
        {scopeStatus}
      </Text>
      <Text testID="e2e-stress-result" style={labStyles.result}>
        {stressStatus}
      </Text>

      <View style={labStyles.row}>
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
            const playServices: unknown = AuthService.hasPlayServices;
            if (
              typeof playServices !== "boolean" ||
              (Platform.OS === "ios" && playServices !== true)
            ) {
              setApiStatus(
                `fail:session-snapshot=play-services-${String(playServices)}`,
              );
              return;
            }
            setApiStatus(
              `ok:session=user=${snapshot.user ? "present" : "none"}:scopes=${snapshot.scopes.length}:play-services=${playServices ? "available" : "unavailable"}:revision=${snapshot.revision}`,
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
});

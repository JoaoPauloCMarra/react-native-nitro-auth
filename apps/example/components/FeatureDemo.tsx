import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  AuthError,
  AuthService,
  SocialButton,
  useAuth,
  type AuthProvider,
  type AuthTokens,
  type AuthUser,
} from "react-native-nitro-auth";
import {
  createStorageItem,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { SmokeTestCard } from "./SmokeTestCard";

const PACKAGE_VERSION = "0.5.10";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const PROVIDERS: readonly {
  id: AuthProvider;
  title: string;
  subtitle: string;
}[] = [
  {
    id: "google",
    title: "Google",
    subtitle: "ID token, access token, scopes, and server auth code path.",
  },
  {
    id: "apple",
    title: "Apple",
    subtitle: "Native Apple Sign-In on iOS and Apple JS on web.",
  },
  {
    id: "microsoft",
    title: "Microsoft",
    subtitle: "Entra ID, tenant-aware OAuth, PKCE, and refresh tokens.",
  },
];

const MICROSOFT_PROMPTS = [
  undefined,
  "login",
  "consent",
  "select_account",
  "none",
] as const;

type MicrosoftPrompt = (typeof MICROSOFT_PROMPTS)[number];

type AuthSnapshot = {
  user: AuthUser | undefined;
  scopes: string[];
  updatedAt: number | undefined;
};

type StatusTone = "idle" | "working" | "success" | "error";

const EMPTY_AUTH_SNAPSHOT: AuthSnapshot = {
  user: undefined,
  scopes: [],
  updatedAt: undefined,
};

const authSnapshotItem = createStorageItem<AuthSnapshot>({
  key: "demo_auth_snapshot",
  scope: StorageScope.Disk,
  defaultValue: EMPTY_AUTH_SNAPSHOT,
});

function dedupeScopes(scopes: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const scope of scopes ?? []) {
    if (!scope || seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    result.push(scope);
  }

  return result;
}

function mergeAuthUser({
  previousUser,
  incomingUser,
  tokenPatch,
}: {
  previousUser: AuthUser | undefined;
  incomingUser: AuthUser | undefined;
  tokenPatch?: Partial<
    Pick<
      AuthUser,
      "accessToken" | "idToken" | "refreshToken" | "expirationTime"
    >
  >;
}): AuthUser | undefined {
  const baseUser = incomingUser ?? previousUser;
  if (!baseUser) {
    return undefined;
  }

  const scopes = dedupeScopes(incomingUser?.scopes ?? previousUser?.scopes);

  return {
    ...previousUser,
    ...incomingUser,
    provider:
      incomingUser?.provider ?? previousUser?.provider ?? baseUser.provider,
    accessToken:
      tokenPatch?.accessToken ??
      incomingUser?.accessToken ??
      previousUser?.accessToken,
    idToken:
      tokenPatch?.idToken ?? incomingUser?.idToken ?? previousUser?.idToken,
    refreshToken:
      tokenPatch?.refreshToken ??
      incomingUser?.refreshToken ??
      previousUser?.refreshToken,
    expirationTime:
      tokenPatch?.expirationTime ??
      incomingUser?.expirationTime ??
      previousUser?.expirationTime,
    serverAuthCode:
      incomingUser?.serverAuthCode ?? previousUser?.serverAuthCode,
    scopes: scopes.length > 0 ? scopes : undefined,
  };
}

function maskSecret(value: string | undefined): string {
  if (!value) {
    return "Not available";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatTime(value: number | undefined): string {
  if (!value) {
    return "Not available";
  }

  return new Date(value).toLocaleString();
}

function formatProvider(provider: AuthProvider | undefined): string {
  if (!provider) {
    return "None";
  }

  return provider[0].toUpperCase() + provider.slice(1);
}

function getErrorStatus(error: AuthError): string {
  return error.underlyingMessage
    ? `${error.code}: ${error.underlyingMessage}`
    : error.code;
}

export function FeatureDemo() {
  const auth = useAuth();
  const [status, setStatus] = useState("Ready");
  const [statusTone, setStatusTone] = useState<StatusTone>("idle");
  const [useOneTap, setUseOneTap] = useState(false);
  const [useLegacyGoogleSignIn, setUseLegacyGoogleSignIn] = useState(false);
  const [persistSnapshot, setPersistSnapshot] = useState(true);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [buttonVariant, setButtonVariant] = useState<
    "primary" | "outline" | "white" | "black"
  >("primary");
  const [microsoftPrompt, setMicrosoftPrompt] =
    useState<MicrosoftPrompt>(undefined);
  const [lastTokens, setLastTokens] = useState<AuthTokens | undefined>();
  const [snapshot, setSnapshot] = useStorage(authSnapshotItem);

  const displayUser =
    auth.user ?? (persistSnapshot ? snapshot.user : undefined);
  const displayScopes = useMemo(() => {
    if (auth.scopes.length > 0) {
      return dedupeScopes(auth.scopes);
    }

    return persistSnapshot ? dedupeScopes(snapshot.scopes) : [];
  }, [auth.scopes, persistSnapshot, snapshot.scopes]);

  const isSnapshotOnly =
    !auth.user && persistSnapshot && Boolean(snapshot.user);
  const hasCalendarScope = auth.scopes.includes(CALENDAR_SCOPE);
  const statusBadgeStyle = getStatusBadgeStyle(statusTone);
  const statusBadgeTextStyle = getStatusBadgeTextStyle(statusTone);

  const setNotice = useCallback(
    (nextStatus: string, tone: StatusTone = "idle") => {
      setStatus(nextStatus);
      setStatusTone(tone);
    },
    [],
  );

  const clearSnapshot = useCallback(() => {
    setSnapshot(EMPTY_AUTH_SNAPSHOT);
  }, [setSnapshot]);

  const persistLatestAuthState = useCallback(
    (tokenPatch?: Partial<AuthTokens>) => {
      if (!persistSnapshot) {
        return;
      }

      setSnapshot((previousSnapshot) => {
        const nextUser = mergeAuthUser({
          previousUser: previousSnapshot.user,
          incomingUser: AuthService.currentUser,
          tokenPatch,
        });

        if (!nextUser) {
          return previousSnapshot;
        }

        const nextScopes = dedupeScopes(
          AuthService.grantedScopes.length > 0
            ? AuthService.grantedScopes
            : (nextUser.scopes ?? previousSnapshot.scopes),
        );

        return {
          user: {
            ...nextUser,
            scopes: nextScopes.length > 0 ? nextScopes : nextUser.scopes,
          },
          scopes: nextScopes,
          updatedAt: Date.now(),
        };
      });
    },
    [persistSnapshot, setSnapshot],
  );

  async function runAuthAction(
    label: string,
    action: () => Promise<void> | void,
  ) {
    try {
      setNotice(label, "working");
      await action();
      setNotice("Done", "success");
    } catch (e) {
      const error = AuthError.from(e);
      setNotice(getErrorStatus(error), "error");
    }
  }

  useEffect(() => {
    AuthService.silentRestore().catch((e: unknown) => {
      const error = AuthError.from(e);
      setNotice(getErrorStatus(error), "error");
    });
  }, [setNotice]);

  useEffect(() => {
    const unsubscribeAuth = AuthService.onAuthStateChanged((nextUser) => {
      if (!nextUser) {
        setNotice("Signed out", "idle");
        return;
      }

      persistLatestAuthState();
      setNotice(
        `Signed in with ${formatProvider(nextUser.provider)}`,
        "success",
      );
    });

    const unsubscribeTokens = AuthService.onTokensRefreshed((tokens) => {
      setLastTokens(tokens);
      persistLatestAuthState(tokens);
      setNotice("Tokens refreshed", "success");
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTokens();
    };
  }, [persistLatestAuthState, setNotice]);

  useEffect(() => {
    if (!persistSnapshot) {
      clearSnapshot();
      return;
    }

    if (auth.user) {
      persistLatestAuthState();
    }
  }, [
    auth.scopes,
    auth.user,
    clearSnapshot,
    persistLatestAuthState,
    persistSnapshot,
  ]);

  function getProviderDisabled(provider: AuthProvider): boolean {
    return provider === "apple" && Platform.OS === "android";
  }

  function getProviderUnavailableText(
    provider: AuthProvider,
  ): string | undefined {
    if (provider === "apple" && Platform.OS === "android") {
      return "Unavailable on Android";
    }

    return undefined;
  }

  async function loginWithProvider(provider: AuthProvider) {
    if (getProviderDisabled(provider)) {
      setNotice("Apple Sign-In is unavailable on Android", "error");
      return;
    }

    await runAuthAction(
      `Signing in with ${formatProvider(provider)}`,
      async () => {
        await auth.login(provider, {
          prompt: provider === "microsoft" ? microsoftPrompt : undefined,
          useOneTap:
            provider === "google" &&
            Platform.OS === "android" &&
            !useLegacyGoogleSignIn
              ? useOneTap
              : undefined,
          useSheet:
            provider === "google" && Platform.OS === "ios"
              ? useOneTap
              : undefined,
          useLegacyGoogleSignIn:
            provider === "google" && Platform.OS === "android"
              ? useLegacyGoogleSignIn
              : undefined,
        });
        persistLatestAuthState();
      },
    );
  }

  function cycleButtonVariant() {
    const variants = ["primary", "outline", "white", "black"] as const;
    const index = variants.indexOf(buttonVariant);
    setButtonVariant(variants[(index + 1) % variants.length]);
  }

  function cycleMicrosoftPrompt() {
    const index = MICROSOFT_PROMPTS.indexOf(microsoftPrompt);
    setMicrosoftPrompt(
      MICROSOFT_PROMPTS[(index + 1) % MICROSOFT_PROMPTS.length],
    );
  }

  function toggleLogging(enabled: boolean) {
    AuthService.setLoggingEnabled(enabled);
    setLoggingEnabled(enabled);
    setNotice(`Logging ${enabled ? "enabled" : "disabled"}`);
  }

  async function getAccessToken() {
    await runAuthAction("Reading access token", async () => {
      const accessToken = await auth.getAccessToken();
      setLastTokens((tokens) => ({ ...tokens, accessToken }));
      if (accessToken) {
        persistLatestAuthState({ accessToken });
      }
      setNotice(
        accessToken ? "Access token loaded" : "No access token",
        "success",
      );
    });
  }

  async function refreshToken() {
    await runAuthAction("Refreshing tokens", async () => {
      const tokens = await auth.refreshToken();
      setLastTokens(tokens);
      persistLatestAuthState(tokens);
    });
  }

  async function silentRestore() {
    await runAuthAction("Restoring session", async () => {
      await auth.silentRestore();
      persistLatestAuthState();
      setNotice(
        AuthService.currentUser ? "Session restored" : "No session found",
      );
    });
  }

  async function requestOrRevokeCalendarScope() {
    if (hasCalendarScope) {
      await runAuthAction("Revoking calendar scope", async () => {
        await auth.revokeScopes([CALENDAR_SCOPE]);
        persistLatestAuthState();
      });
      return;
    }

    await runAuthAction("Requesting calendar scope", async () => {
      await auth.requestScopes([CALENDAR_SCOPE]);
      persistLatestAuthState();
    });
  }

  async function forceAccountPicker() {
    await runAuthAction("Opening account picker", async () => {
      await auth.login("google", {
        forceAccountPicker: true,
        scopes: auth.scopes.length > 0 ? auth.scopes : undefined,
        useLegacyGoogleSignIn:
          Platform.OS === "android" ? useLegacyGoogleSignIn : undefined,
      });
      persistLatestAuthState();
    });
  }

  function logout() {
    auth.logout();
    setLastTokens(undefined);
    clearSnapshot();
    setNotice("Signed out");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>react-native-nitro-auth</Text>
          <Text style={styles.title}>Nitro Auth</Text>
          <Text style={styles.subtitle}>
            Google, Apple, and Microsoft sign-in through a Nitro Modules JSI
            bridge.
          </Text>
          <View style={styles.headerMetaRow}>
            <Text style={styles.headerMeta}>v{PACKAGE_VERSION}</Text>
            <Text style={styles.headerMeta}>{Platform.OS}</Text>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <MetricTile value="3" label="Providers" />
          <MetricTile value={displayScopes.length.toString()} label="Scopes" />
          <MetricTile
            value={auth.hasPlayServices ? "Yes" : "No"}
            label="Play Services"
          />
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Status</Text>
            <View style={[styles.statusBadge, statusBadgeStyle]}>
              <Text style={[styles.statusBadgeText, statusBadgeTextStyle]}>
                {statusTone}
              </Text>
            </View>
          </View>
          <Text style={styles.statusText}>
            {auth.loading ? "Working" : status}
          </Text>
          {auth.error ? (
            <Text style={styles.errorText}>{getErrorStatus(auth.error)}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sign In</Text>
            <Pressable style={styles.smallButton} onPress={cycleButtonVariant}>
              <Text style={styles.smallButtonText}>{buttonVariant}</Text>
            </Pressable>
          </View>

          {PROVIDERS.map((provider) => {
            const unavailableText = getProviderUnavailableText(provider.id);

            return (
              <View
                key={provider.id}
                style={[
                  styles.providerCard,
                  unavailableText ? styles.providerCardDisabled : null,
                ]}
              >
                <View style={styles.providerCopy}>
                  <Text style={styles.providerTitle}>{provider.title}</Text>
                  <Text style={styles.providerSubtitle}>
                    {provider.subtitle}
                  </Text>
                  {unavailableText ? (
                    <Text style={styles.unavailableText}>
                      {unavailableText}
                    </Text>
                  ) : null}
                </View>
                <SocialButton
                  provider={provider.id}
                  variant={provider.id === "apple" ? "black" : buttonVariant}
                  disabled={Boolean(unavailableText)}
                  onPress={() => {
                    void loginWithProvider(provider.id);
                  }}
                />
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session</Text>
          <View style={styles.sessionCard}>
            {displayUser?.photo ? (
              <Image
                source={{ uri: displayUser.photo }}
                style={styles.avatar}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>
                  {(displayUser?.name ?? displayUser?.email ?? "?").slice(0, 1)}
                </Text>
              </View>
            )}
            <View style={styles.sessionBody}>
              <Text style={styles.userName}>
                {displayUser?.name ?? "Signed out"}
              </Text>
              <Text style={styles.userEmail}>
                {displayUser?.email ?? "No active native session"}
              </Text>
              <Text style={styles.sessionMeta}>
                {formatProvider(displayUser?.provider)}
                {isSnapshotOnly ? " snapshot" : ""}
              </Text>
            </View>
          </View>

          <View style={styles.detailPanel}>
            <DetailRow
              label="ID token"
              value={maskSecret(displayUser?.idToken)}
            />
            <DetailRow
              label="Access token"
              value={maskSecret(
                displayUser?.accessToken ?? lastTokens?.accessToken,
              )}
            />
            <DetailRow
              label="Refresh token"
              value={maskSecret(
                displayUser?.refreshToken ?? lastTokens?.refreshToken,
              )}
            />
            <DetailRow
              label="Server code"
              value={maskSecret(displayUser?.serverAuthCode)}
            />
            <DetailRow
              label="Expires"
              value={formatTime(
                displayUser?.expirationTime ?? lastTokens?.expirationTime,
              )}
            />
            <DetailRow
              label="Snapshot"
              value={
                snapshot.updatedAt ? formatTime(snapshot.updatedAt) : "Empty"
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <View style={styles.actionGrid}>
            <ActionButton
              label="Silent restore"
              onPress={() => void silentRestore()}
            />
            <ActionButton
              label="Get token"
              onPress={() => void getAccessToken()}
            />
            <ActionButton
              label="Refresh"
              disabled={!auth.user}
              disabledReason="Sign in first"
              onPress={() => void refreshToken()}
            />
            <ActionButton
              label={hasCalendarScope ? "Revoke scope" : "Request scope"}
              disabled={!auth.user || auth.user.provider === "apple"}
              disabledReason={
                auth.user?.provider === "apple"
                  ? "Not supported for Apple"
                  : "Sign in first"
              }
              onPress={() => void requestOrRevokeCalendarScope()}
            />
            <ActionButton
              label="Account picker"
              onPress={() => void forceAccountPicker()}
            />
            <ActionButton
              label="Sign out"
              tone="danger"
              disabled={!auth.user && !snapshot.user}
              disabledReason="No session"
              onPress={logout}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Options</Text>
          {Platform.OS === "android" ? (
            <>
              <ToggleRow
                label="Credential Manager auto-select"
                value={useOneTap}
                onChange={setUseOneTap}
              />
              <ToggleRow
                label="Legacy Google flow"
                value={useLegacyGoogleSignIn}
                onChange={setUseLegacyGoogleSignIn}
              />
            </>
          ) : null}
          {Platform.OS === "ios" ? (
            <ToggleRow
              label="Google sign-in sheet"
              value={useOneTap}
              onChange={setUseOneTap}
            />
          ) : null}
          <ToggleRow
            label="Persist app snapshot"
            value={persistSnapshot}
            onChange={setPersistSnapshot}
          />
          <ToggleRow
            label="Native logging"
            value={loggingEnabled}
            onChange={toggleLogging}
          />
          <View style={styles.promptRow}>
            <Text style={styles.promptLabel}>
              Microsoft prompt: {microsoftPrompt ?? "default"}
            </Text>
            <Pressable
              style={styles.smallButton}
              onPress={cycleMicrosoftPrompt}
            >
              <Text style={styles.smallButtonText}>Cycle</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <SmokeTestCard />
        </View>
      </ScrollView>
      {auth.loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MetricTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={switchTrackColors}
        thumbColor={value ? "#2563eb" : "#f8fafc"}
      />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  tone = "primary",
  disabled = false,
  disabledReason,
}: {
  label: string;
  onPress: () => void;
  tone?: "primary" | "danger";
  disabled?: boolean;
  disabledReason?: string;
}) {
  const buttonStyle = tone === "danger" ? styles.actionButtonDanger : null;
  const textStyle = tone === "danger" ? styles.actionButtonTextDanger : null;

  return (
    <Pressable
      style={[
        styles.actionButton,
        buttonStyle,
        disabled ? styles.actionButtonDisabled : null,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.actionButtonText, textStyle]}>{label}</Text>
      {disabled && disabledReason ? (
        <Text style={styles.actionButtonHint}>{disabledReason}</Text>
      ) : null}
    </Pressable>
  );
}

const switchTrackColors = {
  false: "#cbd5e1",
  true: "#bfdbfe",
};

function getStatusBadgeStyle(tone: StatusTone) {
  if (tone === "working") {
    return styles.statusBadgeWorking;
  }
  if (tone === "success") {
    return styles.statusBadgeSuccess;
  }
  if (tone === "error") {
    return styles.statusBadgeError;
  }
  return styles.statusBadgeIdle;
}

function getStatusBadgeTextStyle(tone: StatusTone) {
  if (tone === "working") {
    return styles.statusBadgeTextWorking;
  }
  if (tone === "success") {
    return styles.statusBadgeTextSuccess;
  }
  if (tone === "error") {
    return styles.statusBadgeTextError;
  }
  return styles.statusBadgeTextIdle;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f3f6fb",
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 36,
  },
  header: {
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 22,
  },
  eyebrow: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 0,
    marginTop: 8,
  },
  subtitle: {
    color: "#d1d5db",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
  },
  headerMetaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
  },
  headerMeta: {
    backgroundColor: "#1f2937",
    borderColor: "#374151",
    borderRadius: 8,
    borderWidth: 1,
    color: "#f9fafb",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricsGrid: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  metricTile: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  metricValue: {
    color: "#111827",
    fontSize: 22,
    fontWeight: "800",
  },
  metricLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  statusPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  panelTitle: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  statusBadgeIdle: {
    backgroundColor: "#e2e8f0",
  },
  statusBadgeWorking: {
    backgroundColor: "#fef3c7",
  },
  statusBadgeSuccess: {
    backgroundColor: "#dcfce7",
  },
  statusBadgeError: {
    backgroundColor: "#fee2e2",
  },
  statusBadgeTextIdle: {
    color: "#334155",
  },
  statusBadgeTextWorking: {
    color: "#92400e",
  },
  statusBadgeTextSuccess: {
    color: "#166534",
  },
  statusBadgeTextError: {
    color: "#991b1b",
  },
  statusText: {
    color: "#1f2937",
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 12,
    marginTop: 6,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 18,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 10,
  },
  smallButton: {
    backgroundColor: "#e0ecff",
    borderColor: "#bfdbfe",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallButtonText: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "800",
  },
  providerCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  providerCardDisabled: {
    backgroundColor: "#f1f5f9",
    opacity: 0.58,
  },
  providerCopy: {
    marginBottom: 12,
  },
  providerTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "800",
  },
  providerSubtitle: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  unavailableText: {
    color: "#92400e",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  sessionCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 14,
  },
  avatar: {
    backgroundColor: "#e2e8f0",
    borderRadius: 28,
    height: 56,
    marginRight: 12,
    width: 56,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#334155",
    fontSize: 22,
    fontWeight: "800",
  },
  sessionBody: {
    flex: 1,
  },
  userName: {
    color: "#111827",
    fontSize: 17,
    fontWeight: "800",
  },
  userEmail: {
    color: "#475569",
    fontSize: 13,
    marginTop: 3,
  },
  sessionMeta: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  detailPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  detailRow: {
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingVertical: 8,
  },
  detailLabel: {
    color: "#64748b",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  detailValue: {
    color: "#111827",
    flex: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    textAlign: "right",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 8,
    minHeight: 44,
    minWidth: "47%",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionButtonDanger: {
    backgroundColor: "#dc2626",
  },
  actionButtonDisabled: {
    backgroundColor: "#94a3b8",
    opacity: 0.62,
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  actionButtonHint: {
    color: "#f8fafc",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  actionButtonTextDanger: {
    color: "#ffffff",
  },
  toggleRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    minHeight: 52,
    paddingHorizontal: 12,
  },
  toggleLabel: {
    color: "#111827",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    marginRight: 12,
  },
  promptRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dbe3ef",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
  },
  promptLabel: {
    color: "#111827",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  loadingOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(248, 250, 252, 0.75)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});

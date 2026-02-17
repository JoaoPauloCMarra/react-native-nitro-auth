import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  Switch,
  ScrollView,
} from "react-native";
import {
  SocialButton,
  useAuth,
  AuthService,
  type AuthUser,
} from "react-native-nitro-auth";
import {
  createStorageItem,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SHOWCASE_CAPABILITIES = [
  "Google / Apple / Microsoft",
  "JSI-based auth calls",
  "Auth state listener",
  "Token refresh listener",
  "Scope request / revoke",
  "Silent restore",
  "Server auth code support",
  "App-managed Disk snapshot",
] as const;

type AuthSnapshot = {
  user: AuthUser | undefined;
  scopes: string[];
  updatedAt: number | undefined;
};

const EMPTY_AUTH_SNAPSHOT: AuthSnapshot = {
  user: undefined,
  scopes: [],
  updatedAt: undefined,
};

const dedupeScopes = (
  scopesToDedupe: readonly string[] | undefined,
): string[] => {
  const uniqueScopes: string[] = [];
  const seen = new Set<string>();

  for (const scope of scopesToDedupe ?? []) {
    if (!scope || seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    uniqueScopes.push(scope);
  }

  return uniqueScopes;
};

const mergeAuthUser = ({
  previousUser,
  incomingUser,
  tokenPatch,
}: {
  previousUser: AuthUser | undefined;
  incomingUser: AuthUser | undefined;
  tokenPatch?:
    | Partial<
        Pick<
          AuthUser,
          "accessToken" | "idToken" | "refreshToken" | "expirationTime"
        >
      >
    | undefined;
}): AuthUser | undefined => {
  const baseUser = incomingUser ?? previousUser;
  if (!baseUser) {
    return undefined;
  }

  const mergedScopes = dedupeScopes(
    incomingUser?.scopes ?? previousUser?.scopes,
  );
  const mergedUser: AuthUser = {
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
    scopes: mergedScopes.length > 0 ? mergedScopes : undefined,
  };

  return mergedUser;
};

const authSnapshotItem = createStorageItem<AuthSnapshot>({
  key: "demo_auth_snapshot",
  scope: StorageScope.Disk,
  defaultValue: EMPTY_AUTH_SNAPSHOT,
});

export const FeatureDemo = () => {
  const {
    user,
    scopes,
    loading,
    error,
    hasPlayServices,
    login,
    logout,
    requestScopes,
    revokeScopes,
    getAccessToken,
    refreshToken,
  } = useAuth();

  const [status, setStatus] = useState("Ready");
  const [useOneTap, setUseOneTap] = useState(false);
  const [useLegacyGoogleSignIn, setUseLegacyGoogleSignIn] = useState(false);
  const [persistAuthSnapshot, setPersistAuthSnapshot] = useState(true);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authSnapshot, setAuthSnapshot] = useStorage(authSnapshotItem);
  const [variant, setVariant] = useState<
    "primary" | "outline" | "white" | "black"
  >("primary");
  const clearAuthSnapshot = useCallback(() => {
    setAuthSnapshot(EMPTY_AUTH_SNAPSHOT);
  }, [setAuthSnapshot]);
  const persistAuthSnapshotState = useCallback(
    ({
      incomingUser,
      incomingScopes,
      tokenPatch,
    }: {
      incomingUser?: AuthUser;
      incomingScopes?: string[];
      tokenPatch?:
        | Partial<
            Pick<
              AuthUser,
              "accessToken" | "idToken" | "refreshToken" | "expirationTime"
            >
          >
        | undefined;
    } = {}) => {
      if (!persistAuthSnapshot) {
        return;
      }

      setAuthSnapshot((previousSnapshot) => {
        const serviceUser = AuthService.currentUser;
        const nextUser = mergeAuthUser({
          previousUser: previousSnapshot.user,
          incomingUser: incomingUser ?? serviceUser,
          tokenPatch,
        });

        if (!nextUser) {
          return previousSnapshot;
        }

        const nextScopes = dedupeScopes(
          incomingScopes && incomingScopes.length > 0
            ? incomingScopes
            : AuthService.grantedScopes.length > 0
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
    [persistAuthSnapshot, setAuthSnapshot],
  );
  const persistLatestAuthState = useCallback(() => {
    persistAuthSnapshotState({
      incomingUser: AuthService.currentUser,
      incomingScopes: AuthService.grantedScopes,
    });
  }, [persistAuthSnapshotState]);
  const displayUser =
    user ?? (persistAuthSnapshot ? authSnapshot.user : undefined);
  const displayScopes = dedupeScopes(
    scopes.length > 0 ? scopes : persistAuthSnapshot ? authSnapshot.scopes : [],
  );
  const isUsingPersistedSnapshot =
    !user && persistAuthSnapshot && Boolean(authSnapshot.user);
  const statusVariant = error
    ? "error"
    : loading
      ? "pending"
      : displayUser
        ? "connected"
        : "idle";
  const statusBadgeLabel =
    statusVariant === "error"
      ? "Issue"
      : statusVariant === "pending"
        ? "Working"
        : statusVariant === "connected"
          ? "Connected"
          : "Idle";

  useEffect(() => {
    void AuthService.silentRestore();
  }, []);

  useEffect(() => {
    const unsubscribeAuth = AuthService.onAuthStateChanged((u) => {
      setStatus(u ? `Auth: ${u.email || "logged in"}` : "Auth: logged out");
      if (u) {
        persistAuthSnapshotState({
          incomingUser: u,
          incomingScopes: AuthService.grantedScopes,
        });
      }
    });

    const unsubscribeTokens = AuthService.onTokensRefreshed((tokens) => {
      setStatus(
        `Tokens refreshed! Expires: ${tokens.expirationTime ? new Date(tokens.expirationTime).toLocaleTimeString() : "unknown"}`,
      );
      persistAuthSnapshotState({
        incomingScopes: AuthService.grantedScopes,
        tokenPatch: {
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          refreshToken: tokens.refreshToken,
          expirationTime: tokens.expirationTime,
        },
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTokens();
    };
  }, [persistAuthSnapshotState]);

  useEffect(() => {
    if (!persistAuthSnapshot) {
      clearAuthSnapshot();
      return;
    }

    if (!user) {
      return;
    }

    persistAuthSnapshotState({
      incomingUser: user,
      incomingScopes: scopes,
    });
  }, [
    clearAuthSnapshot,
    persistAuthSnapshot,
    persistAuthSnapshotState,
    scopes,
    user,
  ]);

  const hasCalendarScope = scopes.includes(CALENDAR_SCOPE);

  const handleLogin = async (provider: "google" | "apple" | "microsoft") => {
    if (
      provider === "google" &&
      !hasPlayServices &&
      Platform.OS === "android"
    ) {
      setStatus("Error: Play Services unavailable");
      return;
    }
    try {
      setStatus(`Logging in with ${provider}...`);
      await login(provider, {
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
      setStatus(`Logged in as ${AuthService.currentUser?.email}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Login error: ${msg}`);
    }
  };

  const handleLoginWithHint = async () => {
    try {
      setStatus("Login with hint...");
      await login("google", {
        loginHint: "user@gmail.com",
        useLegacyGoogleSignIn:
          Platform.OS === "android" ? useLegacyGoogleSignIn : undefined,
      });
      persistLatestAuthState();
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleForceAccountPicker = async () => {
    try {
      setStatus("Forcing account picker...");
      await login("google", {
        forceAccountPicker: true,
        scopes: scopes.length > 0 ? scopes : undefined,
        useLegacyGoogleSignIn:
          Platform.OS === "android" ? useLegacyGoogleSignIn : undefined,
      });
      persistLatestAuthState();
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRequestScope = async () => {
    try {
      setStatus("Requesting Calendar scope...");
      await requestScopes([CALENDAR_SCOPE]);
      setStatus("Calendar scope granted!");
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRevokeScope = async () => {
    try {
      setStatus("Revoking Calendar scope...");
      await revokeScopes([CALENDAR_SCOPE]);
      setStatus("Calendar scope revoked!");
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleMicrosoftB2CLogin = async () => {
    try {
      setStatus("Logging into Microsoft B2C...");
      await login("microsoft", {
        scopes: [
          "https://stashcafe.onmicrosoft.com/api/user_impersonation",
          "openid",
          "offline_access",
        ],
      });
      persistLatestAuthState();
      setStatus("Logged in with Microsoft B2C!");
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleGetAccessToken = async () => {
    try {
      setStatus("Getting access token...");
      const token = await getAccessToken();
      setAccessToken(token ?? null);
      if (token) {
        persistAuthSnapshotState({
          incomingScopes: AuthService.grantedScopes,
          tokenPatch: { accessToken: token },
        });
      }
      setStatus(token ? `Token: ${token.slice(0, 20)}...` : "No token");
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRefreshToken = async () => {
    try {
      setStatus("Refreshing tokens...");
      const tokens = await refreshToken();
      persistAuthSnapshotState({
        incomingScopes: AuthService.grantedScopes,
        tokenPatch: {
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          refreshToken: tokens.refreshToken,
          expirationTime: tokens.expirationTime,
        },
      });
      setStatus(`Refreshed! New token: ${tokens.accessToken?.slice(0, 15)}...`);
    } catch (e: unknown) {
      setStatus(`Refresh error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleToggleStorage = (enabled: boolean) => {
    setPersistAuthSnapshot(enabled);
    if (!enabled) {
      clearAuthSnapshot();
    }
    setStatus(
      enabled
        ? "Disk snapshot persistence enabled"
        : "Disk snapshot persistence disabled",
    );
  };

  const handleToggleLogging = (enabled: boolean) => {
    AuthService.setLoggingEnabled(enabled);
    setLoggingEnabled(enabled);
    setStatus(`Logging ${enabled ? "enabled" : "disabled"}`);
  };

  const handleToggleLegacyGoogleSignIn = (enabled: boolean) => {
    setUseLegacyGoogleSignIn(enabled);
    if (enabled) {
      setUseOneTap(false);
      setStatus("Legacy Google Sign-In enabled (serverAuthCode available)");
    } else {
      setStatus("Credential Manager enabled (recommended)");
    }
  };

  const cycleVariant = () => {
    const variants: (typeof variant)[] = [
      "primary",
      "outline",
      "white",
      "black",
    ];
    const idx = variants.indexOf(variant);
    setVariant(variants[(idx + 1) % variants.length]);
  };

  const handleLogout = () => {
    logout();
    setAccessToken(null);
    clearAuthSnapshot();
    setStatus("Logged out");
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <View style={styles.headerGlowPrimary} />
        <View style={styles.headerGlowSecondary} />
        <Text style={styles.title}>Nitro Auth</Text>
        <Text style={styles.subtitle}>Modern Feature Showcase (JSI)</Text>
        <Text style={styles.version}>v0.5.3</Text>
      </View>

      <View style={styles.heroPanel}>
        <MetricTile
          value="3"
          label="Providers"
          caption="Google, Apple, Microsoft"
        />
        <MetricTile
          value={displayScopes.length.toString()}
          label="Granted Scopes"
          caption={
            displayUser ? "Current session grants" : "Sign in to inspect"
          }
        />
        <MetricTile
          value={persistAuthSnapshot ? "On" : "Off"}
          label="Disk Snapshot"
          caption="Cleared automatically on logout"
        />
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusLabel}>Status</Text>
          <View
            style={[
              styles.statusBadge,
              statusVariant === "error" && styles.statusBadgeError,
              statusVariant === "pending" && styles.statusBadgePending,
              statusVariant === "connected" && styles.statusBadgeConnected,
              statusVariant === "idle" && styles.statusBadgeIdle,
            ]}
          >
            <Text style={styles.statusBadgeText}>{statusBadgeLabel}</Text>
          </View>
        </View>
        <Text style={styles.statusText}>{status}</Text>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error.message}</Text>
            {"underlyingError" in error &&
              typeof error.underlyingError === "string" && (
                <Text style={styles.errorDetail}>
                  Native: {error.underlyingError}
                </Text>
              )}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Package Showcase</Text>
        <View style={styles.showcaseCard}>
          <Text style={styles.showcaseTitle}>What this demo covers</Text>
          <View style={styles.showcaseGrid}>
            {SHOWCASE_CAPABILITIES.map((capability) => (
              <View key={capability} style={styles.capabilityChip}>
                <Text style={styles.capabilityText}>{capability}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4285F4" />
        </View>
      ) : null}

      {displayUser ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authenticated User</Text>
          <View style={styles.profileCard}>
            {displayUser.photo ? (
              <Image
                source={{ uri: displayUser.photo }}
                style={styles.avatar}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>
                  {displayUser.name?.charAt(0) ||
                    displayUser.email?.charAt(0) ||
                    "?"}
                </Text>
              </View>
            )}
            <Text style={styles.userName}>{displayUser.name || "User"}</Text>
            <Text style={styles.userEmail}>{displayUser.email}</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {displayUser.provider.toUpperCase()}
              </Text>
            </View>
            {isUsingPersistedSnapshot ? (
              <Text style={styles.snapshotHint}>
                Showing persisted Disk snapshot
              </Text>
            ) : null}
          </View>

          <View style={styles.detailsCard}>
            <Text style={styles.detailsTitle}>AuthUser Details</Text>
            <DetailRow label="Provider" value={displayUser.provider} />
            <DetailRow
              label="ID Token"
              value={
                displayUser.idToken
                  ? `${displayUser.idToken.slice(0, 25)}...`
                  : "N/A"
              }
            />
            <DetailRow
              label="Access Token"
              value={
                displayUser.accessToken
                  ? `${displayUser.accessToken.slice(0, 25)}...`
                  : "N/A"
              }
            />
            <DetailRow
              label="Server Auth Code"
              value={displayUser.serverAuthCode ?? "N/A"}
            />
            <DetailRow
              label="Expiration"
              value={
                displayUser.expirationTime
                  ? new Date(displayUser.expirationTime).toLocaleString()
                  : "N/A"
              }
            />
            <DetailRow
              label="Scopes"
              value={`${displayScopes.length} granted`}
            />
            {displayScopes.length > 0 && (
              <Text style={styles.scopesList}>
                {displayScopes
                  .map((s) => s.split("/").pop() ?? s)
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            )}
          </View>

          {user ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Token Operations</Text>
              <View style={styles.buttonRow}>
                <ActionButton
                  label="Get Token"
                  onPress={handleGetAccessToken}
                />
                <ActionButton label="Refresh" onPress={handleRefreshToken} />
              </View>
              {accessToken ? (
                <Text style={styles.tokenPreview}>
                  Token: {accessToken.slice(0, 30)}...
                </Text>
              ) : null}
            </View>
          ) : null}

          {user?.provider === "google" && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Incremental Auth</Text>
              <ActionButton
                label={
                  hasCalendarScope
                    ? "Revoke Calendar Scope"
                    : "Request Calendar Scope"
                }
                onPress={
                  hasCalendarScope ? handleRevokeScope : handleRequestScope
                }
                variant={hasCalendarScope ? "danger" : "primary"}
              />
              <ActionButton
                label="Force Account Picker"
                onPress={handleForceAccountPicker}
                variant="secondary"
              />
            </View>
          )}

          <ActionButton
            label={
              isUsingPersistedSnapshot
                ? "Sign Out + Clear Snapshot"
                : "Sign Out"
            }
            onPress={handleLogout}
            variant="danger"
          />
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Login Options</Text>

          {Platform.OS === "android" && (
            <ToggleRow
              label="Use Credential Manager (One-Tap)"
              value={useOneTap}
              onChange={setUseOneTap}
            />
          )}
          {Platform.OS === "android" && (
            <ToggleRow
              label="Use Legacy Google Sign-In (serverAuthCode)"
              value={useLegacyGoogleSignIn}
              onChange={handleToggleLegacyGoogleSignIn}
            />
          )}
          {Platform.OS === "ios" && (
            <ToggleRow
              label="Use Sign-In Sheet"
              value={useOneTap}
              onChange={setUseOneTap}
            />
          )}

          <View style={styles.variantDemo}>
            <Text style={styles.variantLabel}>Button Variant: {variant}</Text>
            <Pressable onPress={cycleVariant} style={styles.cycleBtn}>
              <Text style={styles.cycleBtnText}>Cycle Variant</Text>
            </Pressable>
          </View>

          <View style={styles.loginButtons}>
            <SocialButton
              provider="google"
              variant={variant}
              onPress={() => handleLogin("google")}
            />
            <View style={styles.spacer} />
            <SocialButton
              provider="apple"
              variant={variant === "primary" ? "black" : variant}
              onPress={() => handleLogin("apple")}
            />
            <View style={styles.spacer} />
            <SocialButton
              provider="microsoft"
              variant={variant === "primary" ? "black" : variant}
              onPress={() => handleLogin("microsoft")}
            />
          </View>

          <View style={styles.advancedSection}>
            <Text style={styles.advancedTitle}>Advanced Options</Text>
            <ActionButton
              label="Microsoft B2C Login"
              onPress={handleMicrosoftB2CLogin}
              variant="secondary"
            />
            <View style={styles.spacer} />
            <ActionButton
              label="Login with Hint"
              onPress={handleLoginWithHint}
              variant="secondary"
            />
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>

        <ToggleRow
          label="Enable Logging"
          value={loggingEnabled}
          onChange={handleToggleLogging}
        />

        <ToggleRow
          label="Disk Storage (Persist snapshot)"
          value={persistAuthSnapshot}
          onChange={handleToggleStorage}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>System Info</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Platform" value={Platform.OS} />
          <InfoRow
            label="Play Services"
            value={hasPlayServices ? "Available" : "Missing"}
            warning={!hasPlayServices && Platform.OS === "android"}
          />
          <InfoRow
            label="Session"
            value={
              user
                ? "Active"
                : isUsingPersistedSnapshot
                  ? "Snapshot only"
                  : "None"
            }
          />
          <InfoRow
            label="Persisted Snapshot"
            value={authSnapshot.user ? "Available" : "None"}
          />
          <InfoRow
            label="Snapshot Backend"
            value={
              Platform.OS === "web"
                ? "nitro-storage Disk (localStorage)"
                : "nitro-storage Disk (native)"
            }
          />
          <InfoRow
            label="Snapshot Updated"
            value={
              authSnapshot.updatedAt
                ? new Date(authSnapshot.updatedAt).toLocaleTimeString()
                : "N/A"
            }
          />
          <InfoRow label="Logging" value={loggingEnabled ? "On" : "Off"} />
        </View>
      </View>

      <View style={[styles.section, styles.lastSection]}>
        <Text style={styles.sectionTitle}>Feature Coverage</Text>
        <View style={styles.checklistCard}>
          <CheckItem label="Google Sign-In" checked />
          <CheckItem label="Apple Sign-In" checked />
          <CheckItem label="Microsoft Sign-In" checked />
          <CheckItem label="One-Tap / Sheet" checked />
          <CheckItem label="Incremental Auth (Scopes)" checked />
          <CheckItem label="Token Refresh" checked />
          <CheckItem label="Auth State Listener" checked />
          <CheckItem label="Token Refresh Listener" checked />
          <CheckItem label="App-level Disk snapshot (nitro-storage)" checked />
          <CheckItem label="Force Account Picker" checked />
          <CheckItem label="Login Hint" checked />
          <CheckItem label="Logging Toggle" checked />
          <CheckItem label="SocialButton Variants" checked />
          <CheckItem label="Legacy Google Sign-In Toggle" checked />
          <CheckItem label="Server Auth Code" checked />
          <CheckItem label="Error Metadata" checked />
        </View>
      </View>
    </ScrollView>
  );
};

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

function ActionButton({
  label,
  onPress,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
}) {
  const bgColors = {
    primary: "#4285F4",
    secondary: "#fff",
    danger: "#ff3b30",
  };
  const textColors = {
    primary: "#fff",
    secondary: "#4285F4",
    danger: "#fff",
  };
  return (
    <Pressable
      style={[
        styles.actionButton,
        { backgroundColor: bgColors[variant] },
        variant === "secondary" && styles.actionButtonOutline,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.actionButtonText, { color: textColors[variant] }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#e0e0e0", true: "#4285F4" }}
      />
    </View>
  );
}

function InfoRow({
  label,
  value,
  warning,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, warning && styles.infoWarning]}>
        {value}
      </Text>
    </View>
  );
}

function CheckItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <View style={styles.checkItem}>
      <View
        style={[
          styles.checkDot,
          checked ? styles.checkDotActive : styles.checkDotInactive,
        ]}
      />
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  );
}

function MetricTile({
  value,
  label,
  caption,
}: {
  value: string;
  label: string;
  caption: string;
}) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricCaption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#edf2ff",
  },
  contentContainer: {
    paddingBottom: 64,
  },
  header: {
    marginHorizontal: 14,
    marginTop: 14,
    backgroundColor: "#0f172a",
    paddingHorizontal: 24,
    paddingTop: 68,
    paddingBottom: 24,
    alignItems: "center",
    borderRadius: 30,
    overflow: "hidden",
    boxShadow: "0 18px 34px rgba(15, 23, 42, 0.22)",
    elevation: 8,
  },
  headerGlowPrimary: {
    position: "absolute",
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "rgba(59, 130, 246, 0.28)",
    top: -120,
    right: -70,
  },
  headerGlowSecondary: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "rgba(14, 165, 233, 0.2)",
    bottom: -110,
    left: -70,
  },
  title: {
    fontSize: 38,
    fontWeight: "800",
    color: "#f8fafc",
    letterSpacing: -0.6,
    fontFamily: Platform.OS === "ios" ? "AvenirNext-Bold" : "sans-serif",
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(226, 232, 240, 0.9)",
    marginTop: 6,
    fontFamily:
      Platform.OS === "ios" ? "AvenirNext-Medium" : "sans-serif-medium",
  },
  version: {
    fontSize: 11,
    color: "#bfdbfe",
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  heroPanel: {
    marginHorizontal: 16,
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  metricTile: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    boxShadow: "0 8px 20px rgba(30, 41, 59, 0.08)",
    elevation: 2,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "#475569",
  },
  metricCaption: {
    marginTop: 5,
    fontSize: 11,
    color: "#64748b",
    lineHeight: 14,
  },
  statusCard: {
    margin: 16,
    marginTop: 14,
    padding: 14,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    boxShadow: "0 8px 24px rgba(30, 41, 59, 0.07)",
    elevation: 2,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 12,
    color: "#334155",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  statusBadgeConnected: {
    backgroundColor: "#dcfce7",
  },
  statusBadgePending: {
    backgroundColor: "#fef3c7",
  },
  statusBadgeError: {
    backgroundColor: "#fee2e2",
  },
  statusBadgeIdle: {
    backgroundColor: "#e2e8f0",
  },
  statusText: {
    fontSize: 14,
    color: "#1e293b",
  },
  errorBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: "#fee2e2",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 13,
  },
  errorDetail: {
    color: "#7f1d1d",
    fontSize: 11,
    marginTop: 4,
  },
  loadingOverlay: {
    alignItems: "center",
    padding: 16,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  showcaseCard: {
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    boxShadow: "0 12px 26px rgba(15, 23, 42, 0.08)",
    elevation: 2,
  },
  showcaseTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 10,
  },
  showcaseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  capabilityChip: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  capabilityText: {
    fontSize: 11,
    color: "#1e3a8a",
    fontWeight: "600",
  },
  profileCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
    elevation: 2,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#e0e0e0",
    marginBottom: 12,
  },
  avatarPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "800",
    color: "#475569",
  },
  userName: {
    fontSize: 21,
    fontWeight: "800",
    color: "#0f172a",
    letterSpacing: -0.2,
  },
  userEmail: {
    fontSize: 14,
    color: "#475569",
    marginTop: 2,
  },
  badge: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#e2e8f0",
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155",
  },
  snapshotHint: {
    marginTop: 8,
    fontSize: 12,
    color: "#1d4ed8",
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailsCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dbe3f0",
  },
  detailLabel: {
    fontSize: 13,
    color: "#64748b",
    flex: 1,
  },
  detailValue: {
    fontSize: 13,
    color: "#0f172a",
    flex: 2,
    textAlign: "right",
    fontWeight: "600",
  },
  scopesList: {
    fontSize: 12,
    color: "#334155",
    marginTop: 8,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    marginVertical: 4,
    boxShadow: "0 6px 16px rgba(59, 130, 246, 0.25)",
    elevation: 2,
  },
  actionButtonOutline: {
    borderWidth: 1,
    borderColor: "#4285F4",
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  tokenPreview: {
    fontSize: 12,
    color: "#334155",
    marginTop: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
  },
  toggleLabel: {
    fontSize: 14,
    color: "#0f172a",
    fontWeight: "600",
  },
  variantDemo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  variantLabel: {
    fontSize: 13,
    color: "#475569",
  },
  cycleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#e2e8f0",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  cycleBtnText: {
    fontSize: 12,
    color: "#334155",
    fontWeight: "700",
  },
  loginButtons: {
    marginBottom: 18,
  },
  spacer: {
    height: 12,
  },
  advancedSection: {
    marginTop: 8,
  },
  advancedTitle: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "700",
    marginBottom: 8,
  },
  infoCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dbe3f0",
  },
  infoLabel: {
    fontSize: 13,
    color: "#64748b",
  },
  infoValue: {
    fontSize: 13,
    color: "#0f172a",
    fontWeight: "600",
  },
  infoWarning: {
    color: "#b45309",
  },
  lastSection: {
    marginBottom: 56,
  },
  checklistCard: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  checkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  checkDotActive: {
    backgroundColor: "#16a34a",
  },
  checkDotInactive: {
    backgroundColor: "#cbd5e1",
  },
  checkLabel: {
    fontSize: 13,
    color: "#0f172a",
  },
});

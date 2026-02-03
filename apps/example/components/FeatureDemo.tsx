import React, { useState, useEffect } from "react";
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
  JSStorageAdapter,
  type AuthUser,
  type AuthTokens,
} from "react-native-nitro-auth";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const memoryStore = new Map<string, string>();

const memoryStorageAdapter: JSStorageAdapter = {
  save: (key, value) => {
    memoryStore.set(key, value);
  },
  load: (key) => memoryStore.get(key),
  remove: (key) => {
    memoryStore.delete(key);
  },
};

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
  const [useCustomStorage, setUseCustomStorage] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [variant, setVariant] = useState<
    "primary" | "outline" | "white" | "black"
  >("primary");

  useEffect(() => {
    const unsubscribeAuth = AuthService.onAuthStateChanged((u) => {
      setStatus(u ? `Auth: ${u.email || "logged in"}` : "Auth: logged out");
    });

    const unsubscribeTokens = AuthService.onTokensRefreshed((tokens) => {
      setStatus(
        `Tokens refreshed! Expires: ${tokens.expirationTime ? new Date(tokens.expirationTime).toLocaleTimeString() : "unknown"}`,
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTokens();
    };
  }, []);

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
          provider === "google" && Platform.OS === "android"
            ? useOneTap
            : undefined,
        useSheet:
          provider === "google" && Platform.OS === "ios"
            ? useOneTap
            : undefined,
      });
      setStatus(`Logged in as ${AuthService.currentUser?.email}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Login error: ${msg}`);
    }
  };

  const handleLoginWithHint = async () => {
    try {
      setStatus("Login with hint...");
      await login("google", { loginHint: "user@gmail.com" });
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
      });
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
      setStatus(token ? `Token: ${token.slice(0, 20)}...` : "No token");
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRefreshToken = async () => {
    try {
      setStatus("Refreshing tokens...");
      const tokens = await refreshToken();
      setStatus(`Refreshed! New token: ${tokens.accessToken?.slice(0, 15)}...`);
    } catch (e: unknown) {
      setStatus(`Refresh error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleToggleStorage = (enabled: boolean) => {
    AuthService.setJSStorageAdapter(enabled ? memoryStorageAdapter : undefined);
    setUseCustomStorage(enabled);
    setStatus(enabled ? "Memory storage enabled" : "Default storage restored");
  };

  const handleToggleLogging = (enabled: boolean) => {
    AuthService.setLoggingEnabled(enabled);
    setLoggingEnabled(enabled);
    setStatus(`Logging ${enabled ? "enabled" : "disabled"}`);
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
    setStatus("Logged out");
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Nitro Auth</Text>
        <Text style={styles.subtitle}>Feature Demo (JSI)</Text>
        <Text style={styles.version}>v0.5.0</Text>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusText}>{status}</Text>
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error.message}</Text>
            {"underlyingError" in error &&
              typeof error.underlyingError === "string" && (
                <Text style={styles.errorDetail}>
                  Native: {error.underlyingError}
                </Text>
              )}
          </View>
        )}
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4285F4" />
        </View>
      )}

      {user ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authenticated User</Text>
          <View style={styles.profileCard}>
            {user.photo ? (
              <Image source={{ uri: user.photo }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>
                  {user.name?.charAt(0) || user.email?.charAt(0) || "?"}
                </Text>
              </View>
            )}
            <Text style={styles.userName}>{user.name || "User"}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {user.provider.toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.detailsCard}>
            <Text style={styles.detailsTitle}>AuthUser Details</Text>
            <DetailRow label="Provider" value={user.provider} />
            <DetailRow
              label="ID Token"
              value={user.idToken ? `${user.idToken.slice(0, 25)}...` : "N/A"}
            />
            <DetailRow
              label="Access Token"
              value={
                user.accessToken ? `${user.accessToken.slice(0, 25)}...` : "N/A"
              }
            />
            <DetailRow
              label="Server Auth Code"
              value={user.serverAuthCode ?? "N/A"}
            />
            <DetailRow
              label="Expiration"
              value={
                user.expirationTime
                  ? new Date(user.expirationTime).toLocaleString()
                  : "N/A"
              }
            />
            <DetailRow label="Scopes" value={`${scopes.length} granted`} />
            {scopes.length > 0 && (
              <Text style={styles.scopesList}>
                {scopes.map((s) => s.split("/").pop()).join(", ")}
              </Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Token Operations</Text>
            <View style={styles.buttonRow}>
              <ActionButton label="Get Token" onPress={handleGetAccessToken} />
              <ActionButton label="Refresh" onPress={handleRefreshToken} />
            </View>
            {accessToken && (
              <Text style={styles.tokenPreview}>
                Token: {accessToken.slice(0, 30)}...
              </Text>
            )}
          </View>

          {user.provider === "google" && (
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
            label="Sign Out"
            onPress={handleLogout}
            variant="danger"
          />
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Login Options</Text>

          {Platform.OS === "android" && (
            <ToggleRow
              label="Use One-Tap Login"
              value={useOneTap}
              onChange={setUseOneTap}
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
          label="Memory Storage (Demo)"
          value={useCustomStorage}
          onChange={handleToggleStorage}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>System Info</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Platform" value={Platform.OS} />
          <InfoRow
            label="Play Services"
            value={hasPlayServices ? "✅ Available" : "❌ Missing"}
            warning={!hasPlayServices && Platform.OS === "android"}
          />
          <InfoRow label="Session" value={user ? "Active" : "None"} />
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
          <CheckItem label="Custom Storage Adapter" checked />
          <CheckItem label="Force Account Picker" checked />
          <CheckItem label="Login Hint" checked />
          <CheckItem label="Logging Toggle" checked />
          <CheckItem label="SocialButton Variants" checked />
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
      <Text style={styles.checkIcon}>{checked ? "✅" : "⬜"}</Text>
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  contentContainer: {
    paddingBottom: 40,
  },
  header: {
    backgroundColor: "#1a1a1a",
    padding: 24,
    paddingTop: 80,
    alignItems: "center",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.7)",
    marginTop: 4,
  },
  version: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    marginTop: 8,
  },
  statusCard: {
    margin: 16,
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    color: "#333",
  },
  errorBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#ffebee",
    borderRadius: 8,
  },
  errorText: {
    color: "#c62828",
    fontSize: 13,
  },
  errorDetail: {
    color: "#666",
    fontSize: 11,
    marginTop: 4,
  },
  loadingOverlay: {
    alignItems: "center",
    padding: 16,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  profileCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
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
    fontWeight: "bold",
    color: "#666",
  },
  userName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  userEmail: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  badge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#f0f0f0",
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#666",
  },
  detailsCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f0",
  },
  detailLabel: {
    fontSize: 13,
    color: "#666",
    flex: 1,
  },
  detailValue: {
    fontSize: 13,
    color: "#333",
    flex: 2,
    textAlign: "right",
  },
  scopesList: {
    fontSize: 11,
    color: "#666",
    marginTop: 4,
    fontStyle: "italic",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginVertical: 4,
  },
  actionButtonOutline: {
    borderWidth: 1,
    borderColor: "#4285F4",
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  tokenPreview: {
    fontSize: 11,
    color: "#666",
    marginTop: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  toggleLabel: {
    fontSize: 14,
    color: "#333",
  },
  variantDemo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  variantLabel: {
    fontSize: 13,
    color: "#666",
  },
  cycleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#e0e0e0",
    borderRadius: 8,
  },
  cycleBtnText: {
    fontSize: 12,
    color: "#333",
  },
  loginButtons: {
    marginBottom: 16,
  },
  spacer: {
    height: 12,
  },
  advancedSection: {
    marginTop: 8,
  },
  advancedTitle: {
    fontSize: 13,
    color: "#666",
    marginBottom: 8,
  },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 13,
    color: "#666",
  },
  infoValue: {
    fontSize: 13,
    color: "#333",
    fontWeight: "600",
  },
  infoWarning: {
    color: "#f39c12",
  },
  lastSection: {
    marginBottom: 40,
  },
  checklistCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  checkIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  checkLabel: {
    fontSize: 13,
    color: "#333",
  },
});

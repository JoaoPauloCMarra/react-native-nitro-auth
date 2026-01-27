import {
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  Switch,
} from "react-native";
import {
  SocialButton,
  useAuth,
  AuthService,
  AuthStorageAdapter,
} from "react-native-nitro-auth";
import { useState, useEffect } from "react";

const EXTRA_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const MockSecureStorage: any = {
  save: (key: string, value: string) => {
    console.log(`[MockSecureStorage] Saving ${key}`);
    globalThis.localStorage?.setItem(`secure_${key}`, value);
  },
  load: (key: string) => {
    console.log(`[MockSecureStorage] Loading ${key}`);
    return globalThis.localStorage?.getItem(`secure_${key}`) || undefined;
  },
  remove: (key: string) => {
    console.log(`[MockSecureStorage] Removing ${key}`);
    globalThis.localStorage?.removeItem(`secure_${key}`);
  },
};

export default function HomeScreen() {
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
  } = useAuth();
  const [localStatus, setLocalStatus] = useState("Welcome");
  const [useOneTap, setUseOneTap] = useState(false);
  const [isSecureStorageEnabled, setIsSecureStorageEnabled] = useState(false);

  useEffect(() => {
    const unsubscribe = AuthService.onTokensRefreshed((tokens) => {
      console.log("Tokens refreshed!", tokens);
      setLocalStatus("Tokens updated automatically!");
    });
    return unsubscribe;
  }, []);

  const toggleSecureStorage = (enabled: boolean) => {
    setIsSecureStorageEnabled(enabled);
    AuthService.setStorageAdapter(enabled ? MockSecureStorage : undefined);
    setLocalStatus(
      enabled ? "Custom Storage Enabled" : "Default Storage Restored"
    );
  };

  const hasExtraScope = scopes.includes(EXTRA_SCOPE);

  const handleLogin = async (provider: "google" | "apple") => {
    if (provider === "google" && !hasPlayServices) {
      setLocalStatus("Error: Google Play Services not available");
      return;
    }
    try {
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
    } catch (e: unknown) {
      // Error is already handled by useAuth and displayed in UI
    }
  };

  const handleRequestScope = async () => {
    try {
      await requestScopes([EXTRA_SCOPE]);
      setLocalStatus("Calendar scope granted!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalStatus(`Error: ${msg}`);
    }
  };

  const handleRevokeScope = async () => {
    try {
      await revokeScopes([EXTRA_SCOPE]);
      setLocalStatus("Calendar scope revoked!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalStatus(`Error: ${msg}`);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Nitro Auth</Text>
        <Text style={styles.subtitle}>Headless + UI Kit</Text>
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color="#000" />
        ) : user ? (
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
            <Text style={styles.userEmail}>{user.email || "No email"}</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {user.provider.toUpperCase()}
              </Text>
            </View>

            {scopes.length > 0 && (
              <View style={styles.scopesContainer}>
                <Text style={styles.scopesLabel}>Scopes:</Text>
                <Text style={styles.scopesText} numberOfLines={2}>
                  {scopes.length} granted
                </Text>
              </View>
            )}

            {user.provider === "google" && (
              <Pressable
                style={[
                  styles.scopeButton,
                  hasExtraScope && styles.scopeButtonRevoke,
                ]}
                onPress={hasExtraScope ? handleRevokeScope : handleRequestScope}
              >
                <Text
                  style={[
                    styles.scopeButtonText,
                    hasExtraScope && styles.scopeButtonTextRevoke,
                  ]}
                >
                  {hasExtraScope
                    ? "Revoke Calendar Scope"
                    : "Request Calendar Scope"}
                </Text>
              </Pressable>
            )}

            <Pressable style={styles.logoutButton} onPress={logout}>
              <Text style={styles.logoutText}>Sign Out</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loginContainer}>
            <Text style={styles.status}>{localStatus}</Text>
            {error && <Text style={styles.error}>{error.message}</Text>}
            <View style={styles.buttonContainer}>
              {Platform.OS === "android" && (
                <View style={styles.oneTapRow}>
                  <Text style={styles.oneTapLabel}>Use One-Tap Login</Text>
                  <Switch
                    value={useOneTap}
                    onValueChange={setUseOneTap}
                    trackColor={{ false: "#767577", true: "#4285F4" }}
                  />
                </View>
              )}
              {Platform.OS === "ios" && (
                <View style={styles.oneTapRow}>
                  <Text style={styles.oneTapLabel}>Use Sign-In Sheet</Text>
                  <Switch
                    value={useOneTap}
                    onValueChange={setUseOneTap}
                    trackColor={{ false: "#767577", true: "#4285F4" }}
                  />
                </View>
              )}
              <SocialButton
                provider="google"
                onPress={() => handleLogin("google")}
              />
              <View style={styles.spacer} />
              <SocialButton
                provider="apple"
                variant="black"
                onPress={() => handleLogin("apple")}
              />
              {(error as any)?.underlyingError && (
                <Text style={styles.underlyingError}>
                  Native Error: {(error as any).underlyingError}
                </Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.setupInsight}>
          <Text style={styles.setupTitle}>Setup Insight</Text>
          <View style={styles.setupRow}>
            <Text style={styles.setupLabel}>Play Services:</Text>
            <Text
              style={[styles.setupValue, !hasPlayServices && styles.setupError]}
            >
              {hasPlayServices ? "Available ✅" : "Missing ❌"}
            </Text>
          </View>
          <View style={styles.setupRow}>
            <Text style={styles.setupLabel}>Auth Persistence:</Text>
            <Text style={styles.setupValue}>Enabled ✅</Text>
          </View>
          <View style={styles.setupRow}>
            <Text style={styles.setupLabel}>Secure Storage:</Text>
            <Switch
              value={isSecureStorageEnabled}
              onValueChange={toggleSecureStorage}
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    backgroundColor: "#1a1a1a",
    padding: 24,
    paddingTop: 80,
    alignItems: "center",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.7)",
    marginTop: 8,
    fontWeight: "500",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  status: {
    fontSize: 16,
    marginBottom: 40,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
  },
  error: {
    fontSize: 14,
    color: "red",
    marginBottom: 16,
    textAlign: "center",
  },
  buttonContainer: {
    width: "100%",
    maxWidth: 320,
  },
  spacer: {
    height: 16,
  },
  profileCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 16,
    backgroundColor: "#f0f0f0",
  },
  avatarPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#e0e0e0",
  },
  avatarText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#666",
  },
  userName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
  },
  badge: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 16,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#666",
    letterSpacing: 1,
  },
  scopesContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  scopesLabel: {
    fontSize: 14,
    color: "#666",
    marginRight: 8,
  },
  scopesText: {
    fontSize: 14,
    color: "#333",
  },
  scopeButton: {
    width: "100%",
    paddingVertical: 12,
    backgroundColor: "#4285F4",
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  scopeButtonRevoke: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#666",
  },
  scopeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  scopeButtonTextRevoke: {
    color: "#666",
  },
  logoutButton: {
    width: "100%",
    paddingVertical: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ff3b30",
    borderRadius: 12,
    alignItems: "center",
  },
  logoutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ff3b30",
  },
  loginContainer: {
    width: "100%",
    alignItems: "center",
  },
  setupInsight: {
    marginTop: 40,
    width: "100%",
    maxWidth: 320,
    padding: 24,
    backgroundColor: "#fff",
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 16,
  },
  setupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f0",
  },
  setupLabel: {
    fontSize: 14,
    color: "#666",
  },
  setupValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4CAF50",
  },
  setupError: {
    color: "#ff3b30",
  },
  oneTapRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  oneTapLabel: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  underlyingError: {
    fontSize: 12,
    color: "#666",
    marginTop: 12,
    textAlign: "center",
    fontStyle: "italic",
    paddingHorizontal: 8,
  },
});

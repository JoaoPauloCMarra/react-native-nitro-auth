import React, { useState } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
} from "react-native";
import type { AuthProvider, AuthUser } from "../Auth.nitro";
import { AuthModule } from "../Auth.web";

interface SocialButtonProps {
  provider: AuthProvider;
  variant?: "primary" | "outline" | "white" | "black";
  borderRadius?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  onSuccess?: (user: AuthUser) => void;
  onError?: (error: unknown) => void;
  onPress?: () => void;
}

async function performLogin(provider: AuthProvider): Promise<void> {
  await AuthModule.login(provider);
}

export const SocialButton: React.FC<SocialButtonProps> = ({
  provider,
  variant = "primary",
  borderRadius = 8,
  style,
  textStyle,
  disabled,
  onSuccess,
  onError,
  onPress,
}) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    if (loading || disabled) return;
    if (onPress) {
      onPress();
      return;
    }
    setLoading(true);
    performLogin(provider)
      .then(() => {
        setLoading(false);
        const user = AuthModule.currentUser;
        if (user) onSuccess?.(user);
      })
      .catch((e) => {
        setLoading(false);
        onError?.(e);
      });
  };

  const isGoogle = provider === "google";
  const isMicrosoft = provider === "microsoft";
  const isDisabled = loading || disabled;

  const getBackgroundColor = () => {
    if (isDisabled) return "#CCCCCC";
    if (variant === "black") return "#000000";
    if (variant === "white") return "#FFFFFF";
    if (variant === "outline") return "transparent";
    if (isGoogle) return "#4285F4";
    if (isMicrosoft) return "#2F2F2F";
    return "#000000";
  };

  const getTextColor = () => {
    if (variant === "white" || variant === "outline") return "#000000";
    return "#FFFFFF";
  };

  const getBorderColor = () => {
    if (variant === "outline") return "#DDDDDD";
    return "transparent";
  };

  return (
    <Pressable
      style={[
        styles.button,
        {
          backgroundColor: getBackgroundColor(),
          borderRadius,
          borderColor: getBorderColor(),
          borderWidth: variant === "outline" ? 1 : 0,
        },
        style,
      ]}
      onPress={handleLogin}
      disabled={isDisabled}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={getTextColor()} />
        ) : (
          <>
            {provider === "google" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={{ fontSize: 18 }}>G</Text>
              </View>
            )}
            {provider === "apple" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={{ fontSize: 18, color: getTextColor() }}></Text>
              </View>
            )}
            {provider === "microsoft" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={{ fontSize: 16 }}>⊞</Text>
              </View>
            )}
            <Text style={[styles.text, { color: getTextColor() }, textStyle]}>
              Sign in with{" "}
              {provider.charAt(0).toUpperCase() + provider.slice(1)}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    flexDirection: "row",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  iconPlaceholder: {
    marginRight: 10,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 16,
    fontWeight: "600",
  },
});

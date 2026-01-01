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
import { NitroModules } from "react-native-nitro-modules";
import type { Auth, AuthProvider, AuthUser } from "../Auth.nitro";

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
  const auth = NitroModules.createHybridObject<Auth>("Auth");
  await auth.login(provider);
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
        const user = NitroModules.createHybridObject<Auth>("Auth").currentUser;
        if (user) onSuccess?.(user);
      })
      .catch((e) => {
        setLoading(false);
        onError?.(e);
      });
  };

  const isGoogle = provider === "google";
  const isDisabled = loading || disabled;

  const getBackgroundColor = () => {
    if (isDisabled) return "#CCCCCC";
    if (variant === "black") return "#000000";
    if (variant === "white") return "#FFFFFF";
    if (variant === "outline") return "transparent";
    return isGoogle ? "#4285F4" : "#000000";
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
          <Text style={[styles.text, { color: getTextColor() }, textStyle]}>
            Sign in with {provider.charAt(0).toUpperCase() + provider.slice(1)}
          </Text>
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
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
  },
  text: {
    fontSize: 16,
    fontWeight: "600",
  },
});

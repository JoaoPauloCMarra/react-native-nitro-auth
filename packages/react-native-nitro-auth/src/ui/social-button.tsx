import React, { useState } from "react";
import type { ViewStyle, TextStyle } from "react-native";
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  ActivityIndicator,
} from "react-native";
import { NitroModules } from "react-native-nitro-modules";
import type { Auth, AuthProvider, AuthUser } from "../Auth.nitro";

export type SocialButtonVariant = "primary" | "outline" | "white" | "black";

export type SocialButtonProps = {
  provider: AuthProvider;
  variant?: SocialButtonVariant;
  borderRadius?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  onSuccess?: (user: AuthUser) => void;
  onError?: (error: unknown) => void;
  onPress?: () => void;
};

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: "Google",
  apple: "Apple",
  microsoft: "Microsoft",
};

const PROVIDER_PRIMARY_BACKGROUND: Record<AuthProvider, string> = {
  google: "#4285F4",
  apple: "#000000",
  microsoft: "#2F2F2F",
};

const getBackgroundColor = ({
  disabled,
  variant,
  provider,
}: {
  disabled: boolean;
  variant: SocialButtonVariant;
  provider: AuthProvider;
}): string => {
  if (disabled) return "#CCCCCC";
  if (variant === "black") return "#000000";
  if (variant === "white") return "#FFFFFF";
  if (variant === "outline") return "transparent";
  return PROVIDER_PRIMARY_BACKGROUND[provider];
};

const getTextColor = (variant: SocialButtonVariant): string =>
  variant === "white" || variant === "outline" ? "#000000" : "#FFFFFF";

async function performLogin(provider: AuthProvider): Promise<void> {
  const auth = NitroModules.createHybridObject<Auth>("Auth");
  await auth.login(provider);
}

export const SocialButton = ({
  provider,
  variant = "primary",
  borderRadius = 8,
  style,
  textStyle,
  disabled,
  onSuccess,
  onError,
  onPress,
}: SocialButtonProps) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (loading || disabled) return;
    if (onPress) {
      onPress();
      return;
    }

    setLoading(true);
    try {
      await performLogin(provider);
      const user = NitroModules.createHybridObject<Auth>("Auth").currentUser;
      if (user) {
        onSuccess?.(user);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      setLoading(false);
    }
  };
  const isDisabled = loading || disabled === true;

  const getBorderColor = () => {
    if (variant === "outline") return "#DDDDDD";
    return "transparent";
  };

  return (
    <Pressable
      style={[
        styles.button,
        {
          backgroundColor: getBackgroundColor({
            disabled: isDisabled,
            variant,
            provider,
          }),
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
          <ActivityIndicator size="small" color={getTextColor(variant)} />
        ) : (
          <>
            {provider === "google" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={{ fontSize: 18 }}>G</Text>
              </View>
            )}
            {provider === "apple" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={{ fontSize: 18, color: getTextColor(variant) }}>
                  
                </Text>
              </View>
            )}
            {provider === "microsoft" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={{ fontSize: 16 }}>⊞</Text>
              </View>
            )}
            <Text
              style={[styles.text, { color: getTextColor(variant) }, textStyle]}
            >
              Sign in with {PROVIDER_LABELS[provider]}
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

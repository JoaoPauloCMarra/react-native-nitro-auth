import React, { useCallback, useMemo, useState } from "react";
import type { ViewStyle, TextStyle } from "react-native";
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  ActivityIndicator,
} from "react-native";
import { AuthService } from "../service";
import { logger } from "../utils/logger";
import type { AuthProvider, AuthUser } from "../Auth.nitro";

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
  microsoft: "#1f2937",
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
  if (disabled) return "#E2E8F0";
  if (variant === "black") return "#000000";
  if (variant === "white") return "#FFFFFF";
  if (variant === "outline") return "transparent";
  return PROVIDER_PRIMARY_BACKGROUND[provider];
};

const getTextColor = ({
  disabled,
  variant,
}: {
  disabled: boolean;
  variant: SocialButtonVariant;
}): string => {
  if (disabled) return "#64748B";
  return variant === "white" || variant === "outline" ? "#111827" : "#FFFFFF";
};

async function performLogin(provider: AuthProvider): Promise<void> {
  await AuthService.login(provider);
}

export const SocialButton = React.memo(function SocialButton({
  provider,
  variant = "primary",
  borderRadius = 8,
  style,
  textStyle,
  disabled,
  onSuccess,
  onError,
  onPress,
}: SocialButtonProps) {
  const [loading, setLoading] = useState(false);
  const isDisabled = loading || disabled === true;

  const handleLogin = useCallback(async () => {
    if (loading || disabled) return;
    if (onPress) {
      onPress();
      return;
    }

    setLoading(true);
    try {
      await performLogin(provider);
      const user = AuthService.currentUser;
      if (user) {
        onSuccess?.(user);
      }
    } catch (error) {
      if (onError) {
        onError(error);
      } else if (__DEV__) {
        logger.error("SocialButton unhandled error:", error);
      }
    } finally {
      setLoading(false);
    }
  }, [disabled, loading, onError, onPress, onSuccess, provider]);

  const buttonStyle = useMemo(
    () => ({
      backgroundColor: getBackgroundColor({
        disabled: isDisabled,
        variant,
        provider,
      }),
      borderRadius,
      borderColor: variant === "outline" ? "#DDDDDD" : "transparent",
      borderWidth: variant === "outline" ? 1 : 0,
    }),
    [borderRadius, isDisabled, provider, variant],
  );

  const textColor = getTextColor({ disabled: isDisabled, variant });
  const labelStyle = useMemo(
    () => [styles.text, { color: textColor }, textStyle],
    [textColor, textStyle],
  );
  const appleIconStyle = useMemo(
    () => [styles.iconText, { color: textColor }],
    [textColor],
  );

  return (
    <Pressable
      style={[styles.button, buttonStyle, style]}
      onPress={handleLogin}
      disabled={isDisabled}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          <>
            {provider === "google" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={styles.iconText}>G</Text>
              </View>
            )}
            {provider === "apple" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={appleIconStyle}></Text>
              </View>
            )}
            {provider === "microsoft" && variant !== "primary" && (
              <View style={styles.iconPlaceholder}>
                <Text style={styles.microsoftIconText}>⊞</Text>
              </View>
            )}
            <Text style={labelStyle}>
              Sign in with {PROVIDER_LABELS[provider]}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
});

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
  iconText: {
    fontSize: 18,
  },
  microsoftIconText: {
    fontSize: 16,
  },
});

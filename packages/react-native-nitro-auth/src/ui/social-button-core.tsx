import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { socialButtonArtwork } from "./social-button-assets";
import { SocialButtonRenderer } from "./social-button-renderer";
import type {
  SocialButtonAppearance,
  SocialButtonContentProps,
  SocialButtonProps,
  SocialButtonRenderMode,
  SocialButtonShape,
  SocialButtonVariant,
} from "./social-button-types";
import { AuthError } from "../utils/auth-error";
import { logger } from "../utils/logger";
import type { AuthProvider, AuthUser } from "../Auth.nitro";

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: "Google",
  apple: "Apple",
  microsoft: "Microsoft",
};

type Props = SocialButtonProps & {
  login: (provider: AuthProvider) => Promise<void>;
  currentUser: () => AuthUser | undefined;
};

function resolveAppearance(
  appearance: SocialButtonAppearance | undefined,
  variant: SocialButtonVariant | undefined,
): SocialButtonAppearance {
  if (appearance) return appearance;
  return variant === "black" ? "dark" : "light";
}

function getButtonDimensions(
  fontScale: number,
  viewportWidth: number,
  renderMode: SocialButtonRenderMode,
  iconOnly: boolean,
) {
  if (iconOnly) return { width: 48, height: 48 };
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const reference = socialButtonArtwork.google[platform].light.pill;
  const baseWidth = renderMode === "custom" ? 264 : 216;
  const baseHeight =
    renderMode === "custom"
      ? 48
      : (baseWidth * reference.height) / reference.width;
  const scale = Math.min(
    Math.max(1, fontScale),
    Math.max(48, viewportWidth - 64) / baseWidth,
  );
  return { width: baseWidth * scale, height: baseHeight * scale };
}

function getMicrosoftBackground(
  disabled: boolean,
  variant: SocialButtonVariant,
): string {
  if (disabled) return Platform.OS === "web" ? "#CCCCCC" : "#E2E8F0";
  if (variant === "black") return "#000000";
  if (variant === "white") return "#FFFFFF";
  if (variant === "outline") return "transparent";
  return Platform.OS === "web" ? "#2F2F2F" : "#1f2937";
}

function getMicrosoftTextColor(
  disabled: boolean,
  variant: SocialButtonVariant,
): string {
  if (disabled && Platform.OS !== "web") return "#64748B";
  return variant === "white" || variant === "outline" ? "#111827" : "#FFFFFF";
}

export function SocialButtonCore({
  provider,
  renderMode = "custom",
  iconOnly = false,
  appearance: requestedAppearance,
  shape: requestedShape,
  variant,
  customComponents,
  style,
  textStyle,
  borderRadius,
  loading = false,
  disabled = false,
  onSuccess,
  onError,
  onPress,
  login,
  currentUser,
}: Props) {
  const [internalLoading, setInternalLoading] = useState(false);
  const requestInProgress = useRef(false);
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const isLoading = loading || internalLoading;
  const isDisabled = disabled || isLoading;
  const label = `Sign in with ${PROVIDER_LABELS[provider]}`;
  const resolvedAppearance = resolveAppearance(requestedAppearance, variant);
  const resolvedShape: SocialButtonShape =
    requestedShape ?? (provider === "microsoft" ? "rectangular" : "pill");

  const handlePress = useCallback(async () => {
    if (requestInProgress.current || isDisabled) return;

    requestInProgress.current = true;
    setInternalLoading(true);
    try {
      if (onPress) {
        await onPress();
      } else {
        await login(provider);
        const user = currentUser();
        if (user) onSuccess?.(user);
      }
    } catch (error) {
      if (onError) {
        onError(AuthError.from(error));
      } else if (typeof __DEV__ !== "undefined" && __DEV__) {
        logger.error("SocialButton unhandled error:", error);
      }
    } finally {
      requestInProgress.current = false;
      setInternalLoading(false);
    }
  }, [currentUser, isDisabled, login, onError, onPress, onSuccess, provider]);

  if (provider === "microsoft") {
    const legacyVariant = variant ?? "primary";
    const customComponent =
      renderMode === "custom" ? customComponents?.microsoft : undefined;
    const contentProps: SocialButtonContentProps = {
      provider,
      label,
      appearance: resolvedAppearance,
      shape: resolvedShape,
      iconOnly: false,
      disabled: isDisabled,
      loading: isLoading,
      width: viewportWidth,
      height: 48,
      ...(renderMode === "custom" && textStyle !== undefined
        ? { textStyle }
        : {}),
      ...(renderMode === "custom" && borderRadius !== undefined
        ? { borderRadius }
        : {}),
    };
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ busy: isLoading, disabled: isDisabled }}
        disabled={isDisabled}
        onPress={handlePress}
        style={[
          styles.microsoftButton,
          {
            backgroundColor: getMicrosoftBackground(isDisabled, legacyVariant),
            borderRadius: borderRadius ?? 8,
            borderColor: variant === "outline" ? "#DDDDDD" : "transparent",
            borderWidth: variant === "outline" ? 1 : 0,
          },
          style,
        ]}
      >
        {customComponent ? (
          React.createElement(customComponent, contentProps)
        ) : (
          <View style={styles.microsoftContent}>
            {isLoading ? (
              <ActivityIndicator
                size="small"
                color={getMicrosoftTextColor(isDisabled, legacyVariant)}
              />
            ) : (
              <>
                {variant !== undefined && variant !== "primary" ? (
                  <Text style={styles.microsoftIconText}>⊞</Text>
                ) : null}
                <Text
                  allowFontScaling
                  style={[
                    styles.microsoftLabel,
                    { color: getMicrosoftTextColor(isDisabled, legacyVariant) },
                    textStyle,
                  ]}
                >
                  {label}
                </Text>
              </>
            )}
          </View>
        )}
      </Pressable>
    );
  }

  const { width, height } = getButtonDimensions(
    fontScale,
    viewportWidth,
    renderMode,
    iconOnly,
  );
  const customContentProps: SocialButtonContentProps = {
    provider,
    label,
    appearance: resolvedAppearance,
    shape: resolvedShape,
    iconOnly,
    disabled: isDisabled,
    loading: isLoading,
    width,
    height,
    ...(renderMode === "custom" && textStyle !== undefined
      ? { textStyle }
      : {}),
    ...(renderMode === "custom" && borderRadius !== undefined
      ? { borderRadius }
      : {}),
  };
  const customComponent =
    renderMode === "custom" ? customComponents?.[provider] : undefined;
  const spinnerColor = resolvedAppearance === "light" ? "#3C4043" : "#FFFFFF";

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: isLoading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={handlePress}
      style={[
        style,
        styles.brandedButton,
        { width, height: Math.max(48, height) },
      ]}
    >
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.artwork, { width, height }]}
      >
        <SocialButtonRenderer
          {...customContentProps}
          provider={provider}
          renderMode={renderMode}
          {...(customComponent ? { customComponent } : {})}
        />
      </View>
      {isLoading ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.loadingIndicator}
        >
          <ActivityIndicator size="small" color={spinnerColor} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brandedButton: {
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
    padding: 0,
    overflow: "visible",
    marginBottom: 28,
  },
  artwork: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingIndicator: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -28,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  microsoftButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    flexDirection: "row",
  },
  microsoftContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  microsoftLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  microsoftIconText: {
    fontSize: 16,
    marginRight: 10,
  },
});

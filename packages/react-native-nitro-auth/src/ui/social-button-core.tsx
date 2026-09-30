import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import {
  SocialButtonBusyContent,
  SocialButtonIndicator,
  SocialButtonRenderer,
} from "./social-button-renderer";
import type { BrandedProvider } from "./social-button-renderer";
import type {
  OfficialSocialButtonRenderMode,
  SocialButtonAppearance,
  SocialButtonContentComponent,
  SocialButtonContentProps,
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

/** Above the 44pt and 48dp minimum touch targets of both platforms. */
const BUTTON_HEIGHT = 48;
/** Fits "Sign in with Microsoft" at the default type size in custom mode. */
const CUSTOM_BUTTON_WIDTH = 264;
const ICON_BUTTON_SIZE = 48;
const VIEWPORT_MARGIN = 64;

type SocialButtonCoreRenderMode = "custom" | OfficialSocialButtonRenderMode;

export type OfficialArtworkProps = {
  provider: BrandedProvider;
  renderMode: OfficialSocialButtonRenderMode;
  appearance: SocialButtonAppearance;
  shape: SocialButtonShape;
  iconOnly: boolean;
  width: number;
  height: number;
};

export type OfficialArtwork = {
  aspect: (provider: BrandedProvider, iconOnly: boolean) => number;
  Renderer: ComponentType<OfficialArtworkProps>;
};

type Props = {
  testID?: string | undefined;
  provider: AuthProvider;
  renderMode?: SocialButtonCoreRenderMode | undefined;
  iconOnly?: boolean | undefined;
  appearance?: SocialButtonAppearance | undefined;
  shape?: SocialButtonShape | undefined;
  variant?: SocialButtonVariant | undefined;
  customComponents?:
    Partial<Record<AuthProvider, SocialButtonContentComponent>> | undefined;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  borderRadius?: number | undefined;
  loading?: boolean | undefined;
  loadingIndicator?: ReactNode;
  disabled?: boolean | undefined;
  onSuccess?: ((user: AuthUser) => void) | undefined;
  onError?: ((error: AuthError) => void) | undefined;
  onPress?: (() => void | Promise<void>) | undefined;
  officialArtwork?: OfficialArtwork | undefined;
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

/**
 * Keeps every render mode at one height so a screen can mix them. Image and SVG
 * modes take their width from the official artwork ratio for the platform.
 */
function getButtonDimensions(
  artworkAspect: number | undefined,
  iconOnly: boolean,
  fontScale: number,
  viewportWidth: number,
) {
  if (iconOnly) {
    return { width: ICON_BUTTON_SIZE, height: ICON_BUTTON_SIZE };
  }
  const baseWidth =
    artworkAspect === undefined
      ? CUSTOM_BUTTON_WIDTH
      : BUTTON_HEIGHT * artworkAspect;
  const scale = Math.min(
    Math.max(1, fontScale),
    Math.max(ICON_BUTTON_SIZE, viewportWidth - VIEWPORT_MARGIN) / baseWidth,
  );
  return { width: baseWidth * scale, height: BUTTON_HEIGHT * scale };
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
  testID,
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
  loadingIndicator,
  disabled = false,
  onSuccess,
  onError,
  onPress,
  officialArtwork,
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
  const official =
    renderMode !== "custom" && officialArtwork !== undefined
      ? { mode: renderMode, artwork: officialArtwork }
      : undefined;
  const missingOfficialArtwork =
    renderMode !== "custom" && officialArtwork === undefined;

  useEffect(() => {
    // Migration signal for untyped callers; shown without enabling logging.
    if (missingOfficialArtwork && typeof __DEV__ !== "undefined" && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        `[NitroAuth] SocialButton renderMode "${renderMode}" requires OfficialSocialButton from "react-native-nitro-auth/official-buttons"; rendering custom mode.`,
      );
    }
  }, [missingOfficialArtwork, renderMode]);

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
      official === undefined ? customComponents?.microsoft : undefined;
    const contentProps: SocialButtonContentProps = {
      provider,
      label,
      appearance: resolvedAppearance,
      shape: resolvedShape,
      iconOnly: false,
      disabled: isDisabled,
      loading: isLoading,
      width: viewportWidth,
      height: BUTTON_HEIGHT,
      ...(official === undefined && textStyle !== undefined
        ? { textStyle }
        : {}),
      ...(official === undefined && borderRadius !== undefined
        ? { borderRadius }
        : {}),
    };
    const textColor = getMicrosoftTextColor(isDisabled, legacyVariant);
    return (
      <Pressable
        testID={testID}
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
            <Text
              allowFontScaling
              numberOfLines={1}
              style={[
                styles.microsoftLabel,
                { color: textColor },
                textStyle,
                isLoading ? styles.hidden : null,
              ]}
            >
              {label}
            </Text>
            {isLoading && loadingIndicator !== null ? (
              <View pointerEvents="none" style={styles.overlay}>
                {loadingIndicator === undefined ? (
                  <ActivityIndicator size="small" color={textColor} />
                ) : (
                  loadingIndicator
                )}
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    );
  }

  const { width, height } = getButtonDimensions(
    official?.artwork.aspect(provider, false),
    iconOnly,
    fontScale,
    viewportWidth,
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
    ...(official === undefined && textStyle !== undefined ? { textStyle } : {}),
    ...(official === undefined && borderRadius !== undefined
      ? { borderRadius }
      : {}),
  };
  const customComponent =
    official === undefined ? customComponents?.[provider] : undefined;
  const showBusyContent = isLoading && loadingIndicator !== null;

  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: isLoading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={handlePress}
      hitSlop={8}
      style={[styles.brandedButton, { width, height }, style]}
    >
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.artwork, { width, height }]}
      >
        {showBusyContent ? (
          <SocialButtonBusyContent
            provider={provider}
            appearance={resolvedAppearance}
            shape={resolvedShape}
            iconOnly={iconOnly}
            width={width}
            height={height}
            {...(official === undefined && borderRadius !== undefined
              ? { borderRadius }
              : {})}
            indicator={
              loadingIndicator === undefined ? (
                <SocialButtonIndicator
                  provider={provider}
                  appearance={resolvedAppearance}
                />
              ) : (
                loadingIndicator
              )
            }
          />
        ) : official ? (
          <official.artwork.Renderer
            provider={provider}
            renderMode={official.mode}
            appearance={resolvedAppearance}
            shape={resolvedShape}
            iconOnly={iconOnly}
            width={width}
            height={height}
          />
        ) : (
          <SocialButtonRenderer
            {...customContentProps}
            provider={provider}
            {...(customComponent ? { customComponent } : {})}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brandedButton: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  artwork: {
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hidden: {
    opacity: 0,
  },
  microsoftButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: BUTTON_HEIGHT,
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
});

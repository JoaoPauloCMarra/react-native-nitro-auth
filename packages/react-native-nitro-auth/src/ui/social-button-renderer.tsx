import React from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import {
  appleLogos,
  googleLogo,
  iconOnlyArtwork,
  socialButtonArtwork,
} from "./social-button-assets";
import type {
  SocialButtonAppearance,
  SocialButtonContentProps,
  SocialButtonRenderMode,
  SocialButtonShape,
} from "./social-button-types";

export type BrandedProvider = "google" | "apple";
type ArtworkPlatform = "android" | "ios";

type Props = SocialButtonContentProps & {
  provider: BrandedProvider;
  renderMode: SocialButtonRenderMode;
  customComponent?: React.ComponentType<SocialButtonContentProps> | undefined;
};

const GOOGLE_COLORS = {
  light: { background: "#FFFFFF", border: "#747775", text: "#1F1F1F" },
  dark: { background: "#131314", border: "#8E918F", text: "#E3E3E3" },
} as const;

const APPLE_COLORS = {
  light: { background: "#FFFFFF", foreground: "#000000" },
  dark: { background: "#000000", foreground: "#FFFFFF" },
} as const;

function artworkPlatform(): ArtworkPlatform {
  return Platform.OS === "ios" ? "ios" : "android";
}

function selectArtwork(
  provider: BrandedProvider,
  platform: ArtworkPlatform,
  appearance: SocialButtonAppearance,
  shape: SocialButtonShape,
  iconOnly: boolean,
) {
  const artwork = iconOnly ? iconOnlyArtwork : socialButtonArtwork;
  return artwork[provider][platform][appearance][shape];
}

function getButtonRadius(
  shape: SocialButtonShape,
  height: number,
  borderRadius?: number,
  iconOnly = false,
): number {
  if (borderRadius !== undefined) return borderRadius;
  if (shape === "pill") return height / 2;
  return iconOnly ? 4 : Math.min(4, height / 8);
}

function getGoogleFontFamily(): string {
  if (Platform.OS === "ios") return "GoogleSans-Medium";
  if (Platform.OS === "android") return "NitroAuthGoogleSans-Medium";
  return "GoogleSans-Medium";
}

function getGoogleLogoSize(height: number): number {
  return (20 * height) / (Platform.OS === "ios" ? 44 : 40);
}

function GoogleSocialButtonContentView({
  appearance,
  borderRadius,
  height,
  iconOnly,
  label,
  shape,
  textStyle,
  width,
}: SocialButtonContentProps) {
  const colors = GOOGLE_COLORS[appearance];
  const radius = getButtonRadius(shape, height, borderRadius, iconOnly);
  const logoSize = getGoogleLogoSize(height);
  const sourceHeight = Platform.OS === "ios" ? 44 : 40;
  const scale = height / sourceHeight;

  return (
    <View
      style={[
        styles.customFrame,
        {
          width,
          height,
          backgroundColor: colors.background,
          borderRadius: radius,
        },
      ]}
    >
      {iconOnly ? (
        <Image
          accessible={false}
          source={googleLogo}
          resizeMode="contain"
          style={{ width: logoSize, height: logoSize }}
        />
      ) : (
        <View style={styles.googleContent}>
          <Image
            accessible={false}
            source={googleLogo}
            resizeMode="contain"
            style={{ width: logoSize, height: logoSize }}
          />
          <Text
            allowFontScaling={false}
            style={[
              styles.googleLabel,
              {
                marginLeft: scale * (Platform.OS === "ios" ? 12 : 10),
                color: colors.text,
                fontSize: scale * 14,
                lineHeight: scale * 20,
                fontFamily: getGoogleFontFamily(),
              },
              textStyle,
            ]}
          >
            {label}
          </Text>
        </View>
      )}
      <View
        pointerEvents="none"
        style={[
          styles.borderOverlay,
          { borderColor: colors.border, borderRadius: radius },
        ]}
      />
    </View>
  );
}

function AppleSocialButtonContentView({
  appearance,
  borderRadius,
  height,
  iconOnly,
  label,
  shape,
  textStyle,
  width,
}: SocialButtonContentProps) {
  const colors = APPLE_COLORS[appearance];
  const radius = getButtonRadius(shape, height, borderRadius, iconOnly);

  if (iconOnly) {
    const art = selectArtwork(
      "apple",
      artworkPlatform(),
      appearance,
      shape,
      true,
    );
    return <SvgXml xml={art.svg} width={width} height={height} />;
  }

  return (
    <View
      style={[
        styles.customFrame,
        {
          width,
          height,
          backgroundColor: colors.background,
          borderRadius: radius,
        },
      ]}
    >
      <View
        style={[
          styles.appleContent,
          {
            paddingLeft: height * 0.1,
            paddingRight: width * 0.08,
          },
        ]}
      >
        <SvgXml
          xml={appleLogos[appearance]}
          width={(height * 31) / 44}
          height={height}
        />
        <Text
          allowFontScaling={false}
          style={[
            styles.appleLabel,
            {
              color: colors.foreground,
              fontSize: height * 0.43,
              lineHeight: height * 0.43 * 1.2,
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.borderOverlay,
          { borderColor: colors.foreground, borderRadius: radius },
        ]}
      />
    </View>
  );
}

/** Default Google button content; usable as a `customComponents.google` override. */
export const GoogleSocialButtonContent = React.memo(
  GoogleSocialButtonContentView,
);

/** Default Apple button content; usable as a `customComponents.apple` override. */
export const AppleSocialButtonContent = React.memo(
  AppleSocialButtonContentView,
);

export function SocialButtonRenderer({
  provider,
  renderMode,
  customComponent,
  ...contentProps
}: Props) {
  if (renderMode === "image" || renderMode === "svg") {
    const art = selectArtwork(
      provider,
      artworkPlatform(),
      contentProps.appearance,
      contentProps.shape,
      contentProps.iconOnly,
    );

    return renderMode === "image" ? (
      <Image
        accessible={false}
        source={art.image}
        resizeMode="contain"
        style={{ width: contentProps.width, height: contentProps.height }}
      />
    ) : (
      <SvgXml
        xml={art.svg}
        width={contentProps.width}
        height={contentProps.height}
      />
    );
  }

  if (customComponent) {
    return React.createElement(customComponent, { provider, ...contentProps });
  }

  return provider === "google" ? (
    <GoogleSocialButtonContent provider={provider} {...contentProps} />
  ) : (
    <AppleSocialButtonContent provider={provider} {...contentProps} />
  );
}

const styles = StyleSheet.create({
  customFrame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  googleContent: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  googleLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  appleContent: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  appleLabel: {
    fontWeight: "500",
    flexShrink: 1,
    minWidth: 0,
  },
  borderOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 1,
  },
});

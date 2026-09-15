import React from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SvgXml } from "react-native-svg";
import {
  appleMarks,
  googleMark,
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

type Chrome = {
  readonly background: string;
  readonly border: string;
  readonly foreground: string;
};

/** Official button colors. Google and Apple both require unaltered chrome. */
const CHROME: Record<
  BrandedProvider,
  Record<SocialButtonAppearance, Chrome>
> = {
  google: {
    light: { background: "#FFFFFF", border: "#747775", foreground: "#1F1F1F" },
    dark: { background: "#131314", border: "#8E918F", foreground: "#E3E3E3" },
  },
  apple: {
    light: { background: "#FFFFFF", border: "#000000", foreground: "#000000" },
    dark: { background: "#000000", border: "#000000", foreground: "#FFFFFF" },
  },
};

/** Gap between the mark and the busy indicator, as a share of button height. */
const BUSY_GAP_SCALE = 0.2;

/** Provider mark width divided by its height, taken from the mark artwork. */
const MARK_RATIO = { google: 200 / 204, apple: 186 / 228 } as const;

/** Apple sizes its mark and label at 43% of the button height. */
const APPLE_MARK_SCALE = 0.43;
const APPLE_LABEL_SCALE = 0.43;
const APPLE_GAP_SCALE = 0.177;

/**
 * Google's official SVG export draws its mark with a Figma conic gradient inside
 * a `foreignObject`, which no native SVG renderer supports. The artwork ships
 * without that block and the mark image is drawn into this box instead.
 */
const GOOGLE_SVG_MARK_SIZE = 20;
const GOOGLE_SVG_MARK_ORIGIN = {
  android: { label: { x: 12, y: 10 }, icon: { x: 10, y: 10 } },
  ios: { label: { x: 16, y: 12 }, icon: { x: 12, y: 12 } },
} as const;

/** Google draws a 20dp mark and 14sp label on its 40dp Android button. */
const GOOGLE_SOURCE_HEIGHT = { android: 40, ios: 44 } as const;
const GOOGLE_MARK_SIZE = 20;
const GOOGLE_LABEL_SIZE = 14;
const GOOGLE_GAP = { android: 10, ios: 12 } as const;

function artworkPlatform(): ArtworkPlatform {
  return Platform.OS === "ios" ? "ios" : "android";
}

function selectArtwork(
  provider: BrandedProvider,
  appearance: SocialButtonAppearance,
  shape: SocialButtonShape,
  iconOnly: boolean,
) {
  const artwork = iconOnly ? iconOnlyArtwork : socialButtonArtwork;
  return artwork[provider][artworkPlatform()][appearance][shape];
}

/** Width divided by height of the official artwork for the active platform. */
export function getArtworkAspect(
  provider: BrandedProvider,
  iconOnly: boolean,
): number {
  const art = selectArtwork(provider, "light", "pill", iconOnly);
  return art.width / art.height;
}

export function getButtonRadius(
  shape: SocialButtonShape,
  height: number,
  borderRadius?: number,
): number {
  if (borderRadius !== undefined) return borderRadius;
  return shape === "pill" ? height / 2 : height / 12;
}

/** Mark height in pixels for a button of the given height. */
export function getMarkHeight(
  provider: BrandedProvider,
  height: number,
): number {
  if (provider === "apple") return height * APPLE_MARK_SCALE;
  return (GOOGLE_MARK_SIZE * height) / GOOGLE_SOURCE_HEIGHT[artworkPlatform()];
}

/** Official provider artwork, sized by height and never cropped or recolored. */
export function ProviderMark({
  provider,
  appearance,
  height,
}: {
  provider: BrandedProvider;
  appearance: SocialButtonAppearance;
  height: number;
}): React.ReactElement {
  return (
    <Image
      accessible={false}
      fadeDuration={0}
      source={provider === "google" ? googleMark : appleMarks[appearance]}
      resizeMode="contain"
      style={{ width: height * MARK_RATIO[provider], height }}
    />
  );
}

function Frame({
  chrome,
  radius,
  width,
  height,
  children,
}: {
  chrome: Chrome;
  radius: number;
  width: number;
  height: number;
  children: ReactNode;
}) {
  return (
    <View
      style={[
        styles.frame,
        {
          width,
          height,
          backgroundColor: chrome.background,
          borderColor: chrome.border,
          borderRadius: radius,
        },
      ]}
    >
      {children}
    </View>
  );
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
  const chrome = CHROME.google[appearance];
  const platform = artworkPlatform();
  const scale = height / GOOGLE_SOURCE_HEIGHT[platform];
  const markHeight = getMarkHeight("google", height);

  return (
    <Frame
      chrome={chrome}
      radius={getButtonRadius(shape, height, borderRadius)}
      width={width}
      height={height}
    >
      <ProviderMark
        provider="google"
        appearance={appearance}
        height={markHeight}
      />
      {iconOnly ? null : (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            styles.label,
            {
              marginLeft: scale * GOOGLE_GAP[platform],
              color: chrome.foreground,
              fontSize: scale * GOOGLE_LABEL_SIZE,
              lineHeight: scale * GOOGLE_LABEL_SIZE * 1.4,
              fontWeight: "500",
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </Frame>
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
  const chrome = CHROME.apple[appearance];
  const fontSize = height * APPLE_LABEL_SCALE;

  return (
    <Frame
      chrome={chrome}
      radius={getButtonRadius(shape, height, borderRadius)}
      width={width}
      height={height}
    >
      <ProviderMark
        provider="apple"
        appearance={appearance}
        height={getMarkHeight("apple", height)}
      />
      {iconOnly ? null : (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            styles.label,
            {
              marginLeft: height * APPLE_GAP_SCALE,
              color: chrome.foreground,
              fontSize,
              lineHeight: fontSize * 1.2,
              fontWeight: "500",
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </Frame>
  );
}

/**
 * Busy content for every render mode. It repeats the provider chrome and mark
 * so the button keeps its artwork, size, and center while a login runs.
 */
export function SocialButtonBusyContent({
  appearance,
  borderRadius,
  height,
  iconOnly,
  indicator,
  provider,
  shape,
  width,
}: {
  appearance: SocialButtonAppearance;
  borderRadius?: number | undefined;
  height: number;
  iconOnly: boolean;
  indicator: ReactNode;
  provider: BrandedProvider;
  shape: SocialButtonShape;
  width: number;
}): React.ReactElement {
  const chrome = CHROME[provider][appearance];
  const markHeight = getMarkHeight(provider, height);

  return (
    <Frame
      chrome={chrome}
      radius={getButtonRadius(shape, height, borderRadius)}
      width={width}
      height={height}
    >
      {iconOnly ? (
        <>
          <View style={styles.dimmedMark}>
            <ProviderMark
              provider={provider}
              appearance={appearance}
              height={markHeight}
            />
          </View>
          <View style={styles.overlay}>{indicator}</View>
        </>
      ) : (
        <>
          <ProviderMark
            provider={provider}
            appearance={appearance}
            height={markHeight}
          />
          <View style={{ marginLeft: height * BUSY_GAP_SCALE }}>
            {indicator}
          </View>
        </>
      )}
    </Frame>
  );
}

/** Default busy indicator, tinted for the active appearance. */
export function SocialButtonIndicator({
  appearance,
  provider,
}: {
  appearance: SocialButtonAppearance;
  provider: BrandedProvider;
}): React.ReactElement {
  return (
    <ActivityIndicator
      size="small"
      color={CHROME[provider][appearance].foreground}
    />
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
      contentProps.appearance,
      contentProps.shape,
      contentProps.iconOnly,
    );
    const { width, height } = contentProps;

    if (renderMode === "image") {
      return (
        <Image
          accessible={false}
          fadeDuration={0}
          source={art.image}
          resizeMode="contain"
          style={{ width, height }}
        />
      );
    }

    if (provider !== "google") {
      return <SvgXml xml={art.svg} width={width} height={height} />;
    }

    const origin =
      GOOGLE_SVG_MARK_ORIGIN[artworkPlatform()][
        contentProps.iconOnly ? "icon" : "label"
      ];
    const unit = width / art.width;
    return (
      <View style={{ width, height }}>
        <SvgXml xml={art.svg} width={width} height={height} />
        <Image
          accessible={false}
          fadeDuration={0}
          source={googleMark}
          resizeMode="contain"
          style={{
            position: "absolute",
            left: origin.x * unit,
            top: origin.y * unit,
            width: GOOGLE_SVG_MARK_SIZE * unit,
            height: GOOGLE_SVG_MARK_SIZE * unit,
          }}
        />
      </View>
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
  frame: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    overflow: "hidden",
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  dimmedMark: {
    opacity: 0.25,
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
});

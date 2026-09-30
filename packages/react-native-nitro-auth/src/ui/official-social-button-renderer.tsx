import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { iconOnlyArtwork, socialButtonArtwork } from "./social-button-assets";
import type {
  OfficialArtwork,
  OfficialArtworkProps,
} from "./social-button-core";
import { googleMark } from "./social-button-marks";
import { artworkPlatform } from "./social-button-renderer";
import type { BrandedProvider } from "./social-button-renderer";
import type {
  SocialButtonAppearance,
  SocialButtonShape,
} from "./social-button-types";

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

function OfficialArtworkRenderer({
  provider,
  renderMode,
  appearance,
  shape,
  iconOnly,
  width,
  height,
}: OfficialArtworkProps): React.ReactElement {
  const art = selectArtwork(provider, appearance, shape, iconOnly);

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
    GOOGLE_SVG_MARK_ORIGIN[artworkPlatform()][iconOnly ? "icon" : "label"];
  const unit = width / art.width;
  return (
    <View style={{ width, height }}>
      <SvgXml xml={art.svg} width={width} height={height} />
      <Image
        accessible={false}
        fadeDuration={0}
        source={googleMark}
        resizeMode="contain"
        style={[
          styles.googleMark,
          {
            left: origin.x * unit,
            top: origin.y * unit,
            width: GOOGLE_SVG_MARK_SIZE * unit,
            height: GOOGLE_SVG_MARK_SIZE * unit,
          },
        ]}
      />
    </View>
  );
}

export const officialArtwork: OfficialArtwork = {
  aspect: getArtworkAspect,
  Renderer: OfficialArtworkRenderer,
};

const styles = StyleSheet.create({
  googleMark: {
    position: "absolute",
  },
});

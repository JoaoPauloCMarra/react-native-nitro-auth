import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import {
  OfficialImageArtwork,
  getArtworkAspect,
  selectImageArtwork,
} from "./official-social-button-renderer";
import type {
  OfficialArtwork,
  OfficialArtworkProps,
} from "./social-button-core";
import { googleMark } from "./social-button-marks";
import { artworkPlatform } from "./social-button-renderer";
import {
  iconOnlySvgArtwork,
  socialButtonSvgArtwork,
} from "./social-button-svg-assets";

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

function OfficialSvgArtwork(props: OfficialArtworkProps): React.ReactElement {
  const { provider, renderMode, appearance, shape, iconOnly, width, height } =
    props;
  if (renderMode === "image") {
    return <OfficialImageArtwork {...props} />;
  }

  const svgArtwork = iconOnly ? iconOnlySvgArtwork : socialButtonSvgArtwork;
  const xml = svgArtwork[provider][artworkPlatform()][appearance][shape];
  if (provider !== "google") {
    return <SvgXml xml={xml} width={width} height={height} />;
  }

  const art = selectImageArtwork(provider, appearance, shape, iconOnly);
  const origin =
    GOOGLE_SVG_MARK_ORIGIN[artworkPlatform()][iconOnly ? "icon" : "label"];
  const unit = width / art.width;
  return (
    <View style={{ width, height }}>
      <SvgXml xml={xml} width={width} height={height} />
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

export const officialSvgArtwork: OfficialArtwork = {
  aspect: getArtworkAspect,
  Renderer: OfficialSvgArtwork,
};

const styles = StyleSheet.create({
  googleMark: {
    position: "absolute",
  },
});

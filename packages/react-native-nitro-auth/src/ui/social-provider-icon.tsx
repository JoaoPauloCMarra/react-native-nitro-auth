import React from "react";
import { Image } from "react-native";
import { SvgXml } from "react-native-svg";
import { appleIconLogos, googleLogo } from "./social-button-assets";
import type { SocialButtonAppearance } from "./social-button-types";

export type SocialProviderIconProps = {
  provider: "google" | "apple";
  appearance?: SocialButtonAppearance;
  size?: number;
};

/** Official provider artwork for custom content, with no font dependency. */
export function SocialProviderIcon({
  provider,
  appearance = "light",
  size = 24,
}: SocialProviderIconProps) {
  return provider === "google" ? (
    <Image
      accessible={false}
      source={googleLogo}
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  ) : (
    <SvgXml
      xml={appleIconLogos[appearance]}
      width={size}
      height={size}
      viewBox="20.5 16 15 19"
      accessible={false}
    />
  );
}

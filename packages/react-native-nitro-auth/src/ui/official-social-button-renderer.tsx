import React, { useEffect } from "react";
import { Image } from "react-native";
import { iconOnlyArtwork, socialButtonArtwork } from "./social-button-assets";
import type {
  OfficialArtwork,
  OfficialArtworkProps,
} from "./social-button-core";
import { artworkPlatform } from "./social-button-renderer";
import type { BrandedProvider } from "./social-button-renderer";
import type {
  SocialButtonAppearance,
  SocialButtonShape,
} from "./social-button-types";

export function selectImageArtwork(
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
  const art = selectImageArtwork(provider, "light", "pill", iconOnly);
  return art.width / art.height;
}

export function OfficialImageArtwork({
  provider,
  appearance,
  shape,
  iconOnly,
  width,
  height,
}: OfficialArtworkProps): React.ReactElement {
  const art = selectImageArtwork(provider, appearance, shape, iconOnly);
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

function OfficialImageOnlyArtwork(
  props: OfficialArtworkProps,
): React.ReactElement {
  const { renderMode } = props;
  useEffect(() => {
    // Migration signal for untyped callers; shown without enabling logging.
    if (renderMode === "svg" && typeof __DEV__ !== "undefined" && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[NitroAuth] OfficialSocialButton renderMode "svg" requires "react-native-nitro-auth/official-buttons/svg"; rendering image artwork.',
      );
    }
  }, [renderMode]);
  return <OfficialImageArtwork {...props} />;
}

export const officialImageArtwork: OfficialArtwork = {
  aspect: getArtworkAspect,
  Renderer: OfficialImageOnlyArtwork,
};

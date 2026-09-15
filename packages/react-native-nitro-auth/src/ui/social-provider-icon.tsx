import React from "react";
import { ProviderMark } from "./social-button-renderer";
import type { BrandedProvider } from "./social-button-renderer";
import type { SocialButtonAppearance } from "./social-button-types";

export type SocialProviderIconProps = {
  provider: BrandedProvider;
  appearance?: SocialButtonAppearance;
  size?: number;
};

/** Official provider artwork for custom content, with no font dependency. */
export function SocialProviderIcon({
  provider,
  appearance = "light",
  size = 24,
}: SocialProviderIconProps): React.ReactElement {
  return (
    <ProviderMark provider={provider} appearance={appearance} height={size} />
  );
}

import React from "react";
import { officialSvgArtwork } from "./official-social-button-svg-renderer";
import { SocialButtonCore } from "./social-button-core";
import type { OfficialSvgSocialButtonProps } from "./social-button-types";
import { AuthService } from "../service.web";
import type { AuthProvider } from "../Auth.nitro";

export type {
  OfficialSvgSocialButtonProps as OfficialSocialButtonProps,
  OfficialSocialButtonRenderMode,
  SocialButtonAppearance,
  SocialButtonShape,
  SocialButtonVariant,
} from "./social-button-types";

const login = (provider: AuthProvider) => AuthService.login(provider);
const currentUser = () => AuthService.currentUser;

export const OfficialSocialButton = React.memo(function OfficialSocialButton(
  props: OfficialSvgSocialButtonProps,
) {
  return (
    <SocialButtonCore
      {...props}
      renderMode={props.renderMode ?? "svg"}
      officialArtwork={officialSvgArtwork}
      login={login}
      currentUser={currentUser}
    />
  );
});

import React from "react";
import { officialArtwork } from "./official-social-button-renderer";
import { SocialButtonCore } from "./social-button-core";
import type { OfficialSocialButtonProps } from "./social-button-types";
import { AuthService } from "../service.web";
import type { AuthProvider } from "../Auth.nitro";

export type {
  OfficialSocialButtonProps,
  OfficialSocialButtonRenderMode,
  SocialButtonAppearance,
  SocialButtonShape,
  SocialButtonVariant,
} from "./social-button-types";

const login = (provider: AuthProvider) => AuthService.login(provider);
const currentUser = () => AuthService.currentUser;

export const OfficialSocialButton = React.memo(function OfficialSocialButton(
  props: OfficialSocialButtonProps,
) {
  return (
    <SocialButtonCore
      {...props}
      officialArtwork={officialArtwork}
      login={login}
      currentUser={currentUser}
    />
  );
});

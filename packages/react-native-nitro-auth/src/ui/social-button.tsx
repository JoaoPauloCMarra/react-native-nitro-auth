import React from "react";
import { SocialButtonCore } from "./social-button-core";
import type { SocialButtonProps } from "./social-button-types";
import { AuthService } from "../service";
import type { AuthProvider } from "../Auth.nitro";

export {
  AppleSocialButtonContent,
  GoogleSocialButtonContent,
} from "./social-button-renderer";

export type {
  SocialButtonAppearance,
  SocialButtonContentComponent,
  SocialButtonContentProps,
  SocialButtonProps,
  SocialButtonRenderMode,
  SocialButtonShape,
  SocialButtonVariant,
} from "./social-button-types";

const login = (provider: AuthProvider) => AuthService.login(provider);
const currentUser = () => AuthService.currentUser;

export const SocialButton = React.memo(function SocialButton(
  props: SocialButtonProps,
) {
  return (
    <SocialButtonCore {...props} login={login} currentUser={currentUser} />
  );
});

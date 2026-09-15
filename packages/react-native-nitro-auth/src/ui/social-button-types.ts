import type { ComponentType } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import type { AuthProvider, AuthUser } from "../Auth.nitro";
import type { AuthError } from "../utils/auth-error";

export type SocialButtonVariant = "primary" | "outline" | "white" | "black";
export type SocialButtonRenderMode = "custom" | "image" | "svg";
export type SocialButtonAppearance = "light" | "dark";
export type SocialButtonShape = "pill" | "rectangular";

/** Visual-only props for a provider-specific custom content component. */
export type SocialButtonContentProps = {
  readonly provider: AuthProvider;
  readonly label: string;
  readonly appearance: SocialButtonAppearance;
  readonly shape: SocialButtonShape;
  readonly iconOnly: boolean;
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly width: number;
  readonly height: number;
  readonly textStyle?: StyleProp<TextStyle>;
  readonly borderRadius?: number;
};

export type SocialButtonContentComponent =
  ComponentType<SocialButtonContentProps>;

type SocialButtonCommonProps = {
  /**
   * `custom` renders provider-aware React Native content; `image` and `svg`
   * render official Google or Apple artwork. Defaults to `custom`.
   */
  appearance?: SocialButtonAppearance;
  shape?: SocialButtonShape;
  /** @deprecated Use `appearance`. Retained for source compatibility. */
  variant?: SocialButtonVariant;
  /**
   * Custom visual content for each provider. The package-owned Pressable keeps
   * control of pressing and accessibility state.
   */
  customComponents?: Partial<
    Record<AuthProvider, SocialButtonContentComponent>
  >;
  /** Layout styles for the package-owned Pressable. */
  style?: StyleProp<ViewStyle>;
  /** Applied only to the default custom renderer and Microsoft. */
  textStyle?: StyleProp<TextStyle>;
  /** Applied only to the default custom renderer and Microsoft. */
  borderRadius?: number;
  /** Provider mark only; supported by Google and Apple. Defaults to false. */
  iconOnly?: boolean;
  /** External busy state, combined with package-managed login progress. */
  loading?: boolean;
  disabled?: boolean;
  onSuccess?: (user: AuthUser) => void;
  /** Receives the normalized runtime error as an AuthError instance. */
  onError?: (error: AuthError) => void;
  onPress?: () => void | Promise<void>;
};

/** Google and Apple support package-provided custom, image, and SVG artwork. */
type BrandedSocialButtonProps = SocialButtonCommonProps & {
  provider: "google" | "apple";
  renderMode?: SocialButtonRenderMode;
  iconOnly?: boolean;
};

/** Microsoft retains its existing custom renderer and accepts dynamic providers. */
type CustomSocialButtonProps = SocialButtonCommonProps & {
  provider: AuthProvider;
  renderMode?: "custom";
  iconOnly?: false;
};

export type SocialButtonProps =
  BrandedSocialButtonProps | CustomSocialButtonProps;

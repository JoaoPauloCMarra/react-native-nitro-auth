import type { ComponentType, ReactNode } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import type { AuthProvider, AuthUser } from "../Auth.nitro";
import type { AuthError } from "../utils/auth-error";

export type SocialButtonVariant = "primary" | "outline" | "white" | "black";
export type SocialButtonRenderMode = "custom";
export type OfficialSocialButtonRenderMode = "image" | "svg";
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
  /**
   * Button width for Google and Apple. For Microsoft, the window width; the
   * Microsoft button fills its parent, so size its content from layout.
   */
  readonly width: number;
  readonly height: number;
  readonly textStyle?: StyleProp<TextStyle>;
  readonly borderRadius?: number;
};

export type SocialButtonContentComponent =
  ComponentType<SocialButtonContentProps>;

type SocialButtonBehaviorProps = {
  /** Test identifier for the package-owned Pressable. */
  testID?: string;
  appearance?: SocialButtonAppearance;
  shape?: SocialButtonShape;
  /** @deprecated Use `appearance`. Retained for source compatibility. */
  variant?: SocialButtonVariant;
  /** Layout styles for the package-owned Pressable. */
  style?: StyleProp<ViewStyle>;
  /** External busy state, combined with package-managed login progress. */
  loading?: boolean;
  /** Google/Apple in-button indicator override; null lets custom content own busy visuals. */
  loadingIndicator?: ReactNode;
  disabled?: boolean;
  onSuccess?: (user: AuthUser) => void;
  /** Receives the normalized runtime error as an AuthError instance. */
  onError?: (error: AuthError) => void;
  onPress?: () => void | Promise<void>;
};

type SocialButtonCommonProps = SocialButtonBehaviorProps & {
  /**
   * `custom` renders provider-aware React Native content and is the only mode
   * of the root `SocialButton`. Official artwork lives in
   * `react-native-nitro-auth/official-buttons`.
   */
  renderMode?: SocialButtonRenderMode;
  /**
   * Custom visual content for each provider. The package-owned Pressable keeps
   * control of pressing and accessibility state.
   */
  customComponents?: Partial<
    Record<AuthProvider, SocialButtonContentComponent>
  >;
  /** Applied only to the default custom renderer and Microsoft. */
  textStyle?: StyleProp<TextStyle>;
  /** Applied only to the default custom renderer and Microsoft. */
  borderRadius?: number;
};

/** Google and Apple support package-provided custom content. */
type BrandedSocialButtonProps = SocialButtonCommonProps & {
  provider: "google" | "apple";
  /** Provider mark only; supported by Google and Apple. Defaults to false. */
  iconOnly?: boolean;
};

/** Microsoft retains its existing custom renderer and accepts dynamic providers. */
type CustomSocialButtonProps = SocialButtonCommonProps & {
  provider: AuthProvider;
  iconOnly?: false;
};

export type SocialButtonProps =
  BrandedSocialButtonProps | CustomSocialButtonProps;

type OfficialSocialButtonBaseProps = SocialButtonBehaviorProps & {
  provider: "google" | "apple";
  iconOnly?: boolean;
};

export type OfficialSocialButtonProps = OfficialSocialButtonBaseProps & {
  /**
   * Official PNG artwork. SVG artwork is exported from
   * `react-native-nitro-auth/official-buttons/svg`.
   */
  renderMode?: "image";
};

export type OfficialSvgSocialButtonProps = OfficialSocialButtonBaseProps & {
  /** Official SVG or PNG artwork. Defaults to `svg`. */
  renderMode?: OfficialSocialButtonRenderMode;
};

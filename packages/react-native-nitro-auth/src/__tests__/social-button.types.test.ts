import type { SocialButtonProps, SocialButtonRenderMode } from "../index";
import type { SocialButtonProps as WebSocialButtonProps } from "../index.web";
import type {
  OfficialSocialButtonProps,
  OfficialSocialButtonRenderMode,
} from "../official-buttons";
import type { OfficialSocialButtonProps as OfficialSvgSocialButtonProps } from "../official-buttons-svg";
import type { OfficialSocialButtonProps as WebOfficialSvgSocialButtonProps } from "../official-buttons-svg.web";
import type {
  OfficialSocialButtonProps as WebOfficialSocialButtonProps,
  OfficialSocialButtonRenderMode as WebOfficialSocialButtonRenderMode,
} from "../official-buttons.web";

type AssertTrue<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type RootRenderModeIsCustom = AssertTrue<
  IsEqual<SocialButtonRenderMode, "custom">
>;
type OfficialRenderModes = AssertTrue<
  IsEqual<OfficialSocialButtonRenderMode, "image" | "svg">
>;
type WebOfficialRenderModes = AssertTrue<
  IsEqual<WebOfficialSocialButtonRenderMode, OfficialSocialButtonRenderMode>
>;
type WebOfficialPropsMatchNative = AssertTrue<
  IsEqual<WebOfficialSocialButtonProps, OfficialSocialButtonProps>
>;
type WebOfficialSvgPropsMatchNative = AssertTrue<
  IsEqual<WebOfficialSvgSocialButtonProps, OfficialSvgSocialButtonProps>
>;
type SvgRenderModes = AssertTrue<
  IsEqual<
    NonNullable<OfficialSvgSocialButtonProps["renderMode"]>,
    "image" | "svg"
  >
>;

const rootCustom: SocialButtonProps = {
  provider: "google",
  renderMode: "custom",
  iconOnly: true,
};
const rootDefault: SocialButtonProps = { provider: "microsoft" };
const webRootCustom: WebSocialButtonProps = { provider: "apple" };

const rootImage: SocialButtonProps = {
  provider: "google",
  // @ts-expect-error Official artwork moved to react-native-nitro-auth/official-buttons.
  renderMode: "image",
};
const rootSvg: SocialButtonProps = {
  provider: "apple",
  // @ts-expect-error Official artwork moved to react-native-nitro-auth/official-buttons.
  renderMode: "svg",
};
const webRootImage: WebSocialButtonProps = {
  provider: "google",
  // @ts-expect-error Official artwork moved to react-native-nitro-auth/official-buttons.
  renderMode: "image",
};
const webRootSvg: WebSocialButtonProps = {
  provider: "apple",
  // @ts-expect-error Official artwork moved to react-native-nitro-auth/official-buttons.
  renderMode: "svg",
};

const officialImage: OfficialSocialButtonProps = {
  provider: "google",
  renderMode: "image",
  iconOnly: true,
  appearance: "dark",
  shape: "rectangular",
  loadingIndicator: null,
};
const officialSvg: WebOfficialSvgSocialButtonProps = {
  provider: "apple",
  renderMode: "svg",
};
const officialImageOnlySvg: OfficialSocialButtonProps = {
  provider: "apple",
  // @ts-expect-error SVG artwork moved to react-native-nitro-auth/official-buttons/svg.
  renderMode: "svg",
};
const officialCustom: OfficialSocialButtonProps = {
  provider: "google",
  // @ts-expect-error Custom content belongs to the root SocialButton.
  renderMode: "custom",
};
const officialMicrosoft: OfficialSocialButtonProps = {
  // @ts-expect-error Official artwork exists only for Google and Apple.
  provider: "microsoft",
  renderMode: "image",
};
const officialWithoutMode: OfficialSocialButtonProps = { provider: "google" };
const officialTextStyle: OfficialSocialButtonProps = {
  provider: "google",
  renderMode: "image",
  // @ts-expect-error Official artwork does not accept text styling.
  textStyle: { fontSize: 12 },
};
const officialCustomComponents: OfficialSocialButtonProps = {
  provider: "google",
  // @ts-expect-error Official artwork does not accept custom content.
  customComponents: {},
};
const officialBorderRadius: OfficialSocialButtonProps = {
  provider: "apple",
  // @ts-expect-error Official artwork keeps its own corner radius.
  borderRadius: 4,
};

test("social button props separate custom and official render modes", () => {
  expect([
    rootCustom,
    rootDefault,
    webRootCustom,
    rootImage,
    rootSvg,
    webRootImage,
    webRootSvg,
    officialImage,
    officialSvg,
    officialImageOnlySvg,
    officialCustom,
    officialMicrosoft,
    officialWithoutMode,
    officialTextStyle,
    officialCustomComponents,
    officialBorderRadius,
  ]).toHaveLength(16);
});

void (0 as unknown as RootRenderModeIsCustom);
void (0 as unknown as OfficialRenderModes);
void (0 as unknown as WebOfficialRenderModes);
void (0 as unknown as WebOfficialPropsMatchNative);
void (0 as unknown as WebOfficialSvgPropsMatchNative);
void (0 as unknown as SvgRenderModes);

import type { ImageSourcePropType } from "react-native";

/** Official provider marks, used by the custom renderer and busy states. */
export const googleMark =
  require("./assets/google-logo.png") as ImageSourcePropType;

export const appleMarks = {
  light: require("./assets/apple-mark-light.png") as ImageSourcePropType,
  dark: require("./assets/apple-mark-dark.png") as ImageSourcePropType,
} as const;

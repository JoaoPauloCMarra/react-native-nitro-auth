import {
  AuthError,
  getProviderTokenCapabilities,
  type AuthPlatform,
} from "react-native-nitro-auth";

export function authErrorCode(error: unknown): string {
  return error instanceof AuthError ? error.code : "unknown";
}

export function capabilityMatrixMatches(platform: AuthPlatform): boolean {
  const google = getProviderTokenCapabilities("google", platform);
  const apple = getProviderTokenCapabilities("apple", platform);
  const microsoft = getProviderTokenCapabilities("microsoft", platform);
  return (
    google.supportsAccessToken === (platform !== "android") &&
    google.supportsClientSideRefresh &&
    google.supportsServerAuthCode &&
    google.accessTokenExpirySource ===
      (platform === "android" ? "id_token" : "access_token") &&
    apple.supportsAccessToken === false &&
    apple.supportsClientSideRefresh === false &&
    apple.supportsServerAuthCode === false &&
    apple.accessTokenExpirySource === "unavailable" &&
    microsoft.supportsAccessToken &&
    microsoft.supportsClientSideRefresh &&
    microsoft.supportsServerAuthCode === false &&
    microsoft.accessTokenExpirySource === "access_token"
  );
}

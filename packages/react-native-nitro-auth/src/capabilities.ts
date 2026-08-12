import type { AuthProvider } from "./Auth.nitro";

export type AuthPlatform = "ios" | "android" | "web";

/**
 * Typed token capabilities for a provider on a platform. Capabilities are
 * factual: a capability is only `true` when a supported flow can actually
 * produce the value on that platform. See `docs/error-contract.md` for the
 * per-platform matrix.
 */
export type ProviderTokenCapabilities = {
  provider: AuthProvider;
  platform: AuthPlatform;
  /** A direct OAuth access token can be produced on this platform. */
  supportsAccessToken: boolean;
  /** A refresh token or SDK-backed silent refresh is available client-side. */
  supportsClientSideRefresh: boolean;
  /** A server auth code can be produced on this platform. */
  supportsServerAuthCode: boolean;
  /**
   * Where `expirationTime` is derived from when a session is present:
   * the OAuth access-token expiry, an ID-token `exp` fallback, or nothing.
   */
  accessTokenExpirySource: "access_token" | "id_token" | "unavailable";
};

const GOOGLE_CAPABILITIES: Record<AuthPlatform, ProviderTokenCapabilities> = {
  ios: {
    provider: "google",
    platform: "ios",
    supportsAccessToken: true,
    supportsClientSideRefresh: true,
    supportsServerAuthCode: true,
    accessTokenExpirySource: "access_token",
  },
  android: {
    provider: "google",
    platform: "android",
    // Google One Tap and legacy Google Sign-In return an ID token and
    // optionally a server auth code, never an OAuth access token.
    supportsAccessToken: false,
    supportsClientSideRefresh: true,
    supportsServerAuthCode: true,
    // Documented fallback: derived from the ID-token `exp` claim.
    accessTokenExpirySource: "id_token",
  },
  web: {
    provider: "google",
    platform: "web",
    supportsAccessToken: true,
    supportsClientSideRefresh: true,
    supportsServerAuthCode: true,
    accessTokenExpirySource: "access_token",
  },
};

const APPLE_CAPABILITIES: Record<AuthPlatform, ProviderTokenCapabilities> = {
  ios: {
    provider: "apple",
    platform: "ios",
    supportsAccessToken: false,
    supportsClientSideRefresh: false,
    supportsServerAuthCode: false,
    accessTokenExpirySource: "unavailable",
  },
  android: {
    provider: "apple",
    platform: "android",
    supportsAccessToken: false,
    supportsClientSideRefresh: false,
    supportsServerAuthCode: false,
    accessTokenExpirySource: "unavailable",
  },
  web: {
    provider: "apple",
    platform: "web",
    supportsAccessToken: false,
    supportsClientSideRefresh: false,
    supportsServerAuthCode: false,
    accessTokenExpirySource: "unavailable",
  },
};

const MICROSOFT_CAPABILITIES: Record<AuthPlatform, ProviderTokenCapabilities> =
  {
    ios: {
      provider: "microsoft",
      platform: "ios",
      supportsAccessToken: true,
      supportsClientSideRefresh: true,
      supportsServerAuthCode: false,
      accessTokenExpirySource: "access_token",
    },
    android: {
      provider: "microsoft",
      platform: "android",
      supportsAccessToken: true,
      supportsClientSideRefresh: true,
      supportsServerAuthCode: false,
      accessTokenExpirySource: "access_token",
    },
    web: {
      provider: "microsoft",
      platform: "web",
      supportsAccessToken: true,
      supportsClientSideRefresh: true,
      supportsServerAuthCode: false,
      accessTokenExpirySource: "access_token",
    },
  };

export function getProviderTokenCapabilities(
  provider: AuthProvider,
  platform: AuthPlatform,
): ProviderTokenCapabilities {
  switch (provider) {
    case "google":
      return GOOGLE_CAPABILITIES[platform];
    case "apple":
      return APPLE_CAPABILITIES[platform];
    case "microsoft":
      return MICROSOFT_CAPABILITIES[platform];
  }
}

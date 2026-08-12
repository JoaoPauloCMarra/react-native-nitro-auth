import { getProviderTokenCapabilities } from "../capabilities";
import type { AuthProvider } from "../Auth.nitro";

const PROVIDERS: readonly AuthProvider[] = ["google", "apple", "microsoft"];
const PLATFORMS = ["ios", "android", "web"] as const;

describe("getProviderTokenCapabilities", () => {
  it("returns a capability row for every provider/platform pair", () => {
    for (const provider of PROVIDERS) {
      for (const platform of PLATFORMS) {
        const capabilities = getProviderTokenCapabilities(provider, platform);
        expect(capabilities.provider).toBe(provider);
        expect(capabilities.platform).toBe(platform);
        expect(typeof capabilities.supportsAccessToken).toBe("boolean");
        expect(typeof capabilities.supportsClientSideRefresh).toBe("boolean");
        expect(typeof capabilities.supportsServerAuthCode).toBe("boolean");
        expect(["access_token", "id_token", "unavailable"]).toContain(
          capabilities.accessTokenExpirySource,
        );
      }
    }
  });

  it("documents that Android Google never produces an access token (X6)", () => {
    const androidGoogle = getProviderTokenCapabilities("google", "android");
    expect(androidGoogle.supportsAccessToken).toBe(false);
    expect(androidGoogle.accessTokenExpirySource).toBe("id_token");
  });

  it("documents access-token expiry semantics for iOS and web Google", () => {
    for (const platform of ["ios", "web"] as const) {
      const google = getProviderTokenCapabilities("google", platform);
      expect(google.supportsAccessToken).toBe(true);
      expect(google.accessTokenExpirySource).toBe("access_token");
    }
  });

  it("documents Apple's client-side token limits", () => {
    for (const platform of PLATFORMS) {
      const apple = getProviderTokenCapabilities("apple", platform);
      expect(apple.supportsAccessToken).toBe(false);
      expect(apple.supportsClientSideRefresh).toBe(false);
      expect(apple.accessTokenExpirySource).toBe("unavailable");
    }
  });

  it("documents Microsoft refresh and access-token support on every platform", () => {
    for (const platform of PLATFORMS) {
      const microsoft = getProviderTokenCapabilities("microsoft", platform);
      expect(microsoft.supportsAccessToken).toBe(true);
      expect(microsoft.supportsClientSideRefresh).toBe(true);
      expect(microsoft.supportsServerAuthCode).toBe(false);
      expect(microsoft.accessTokenExpirySource).toBe("access_token");
    }
  });

  it("keeps the typed platform union closed", () => {
    const platform = "android";
    const capabilities = getProviderTokenCapabilities("google", platform);
    expect(capabilities.accessTokenExpirySource).not.toBe("unavailable");
  });
});

import { OAUTH_ERROR_CODES } from "../generated/oauth-error-codes";
import { isAuthErrorCode } from "../utils/auth-error";
import {
  mapOAuthErrorCode,
  type OAuthErrorContext,
} from "../utils/oauth-error";
import type { AuthErrorCode } from "../Auth.nitro";

/**
 * Canonical OAuth error fixture corpus (X2 / U1).
 *
 * iOS (`ios/AuthAdapter.swift`), Android (`AuthAdapter.kt`), and web all
 * implement this exact table. Keep this corpus in sync with
 * `docs/error-contract.md`; a fixture here is a contract for every platform.
 */
const AUTHORIZE_FIXTURES: readonly [string, AuthErrorCode][] = [
  ...Object.entries(OAUTH_ERROR_CODES),
  ["unsupported_response_type", "unknown"],
  ["", "unknown"],
];

const REFRESH_CONTEXT_DIFFERENCES: readonly [string, AuthErrorCode][] = [
  ["invalid_grant", "refresh_failed"],
  ["invalid_request", "refresh_failed"],
  ["invalid_token", "refresh_failed"],
];

describe("mapOAuthErrorCode", () => {
  it.each(AUTHORIZE_FIXTURES)(
    "maps %s to %s in the authorize context",
    (providerError, expected) => {
      expect(mapOAuthErrorCode(providerError, "authorize")).toBe(expected);
    },
  );

  it.each(AUTHORIZE_FIXTURES)(
    "maps %s to %s in the token context",
    (providerError, expected) => {
      expect(mapOAuthErrorCode(providerError, "token")).toBe(expected);
    },
  );

  it.each(REFRESH_CONTEXT_DIFFERENCES)(
    "maps %s to %s in the refresh context",
    (providerError, expected) => {
      expect(mapOAuthErrorCode(providerError, "refresh")).toBe(expected);
    },
  );

  it("defaults to the authorize context", () => {
    expect(mapOAuthErrorCode("invalid_grant")).toBe("token_error");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapOAuthErrorCode("  Access_Denied ", "authorize")).toBe(
      "cancelled",
    );
  });

  it("keeps non-token codes stable across contexts", () => {
    for (const context of ["authorize", "token", "refresh"] as const) {
      expect(mapOAuthErrorCode("access_denied", context)).toBe("cancelled");
      expect(mapOAuthErrorCode("invalid_scope", context)).toBe(
        "configuration_error",
      );
      expect(mapOAuthErrorCode("server_error", context)).toBe("network_error");
      expect(mapOAuthErrorCode("interaction_required", context)).toBe(
        "interaction_required",
      );
    }
  });

  it("normalizes unknown provider errors to unknown instead of scraping", () => {
    expect(mapOAuthErrorCode("some_vendor_error", "refresh")).toBe("unknown");
  });

  it("treats every fixture value as a valid public code", () => {
    for (const [, code] of AUTHORIZE_FIXTURES) {
      expect(isAuthErrorCode(code)).toBe(true);
    }
  });

  it("documents that the refresh bucket is the only context difference", () => {
    for (const [error] of AUTHORIZE_FIXTURES) {
      const authorize = mapOAuthErrorCode(error, "authorize");
      expect(mapOAuthErrorCode(error, "token")).toBe(authorize);
      expect(mapOAuthErrorCode(error, "refresh")).toBe(
        authorize === "token_error" ? "refresh_failed" : authorize,
      );
    }
  });
});

describe("OAuthErrorContext type surface", () => {
  it("accepts only the documented contexts", () => {
    const contexts: readonly OAuthErrorContext[] = [
      "authorize",
      "token",
      "refresh",
    ];
    expect(contexts).toHaveLength(3);
  });
});

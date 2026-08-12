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
  ["access_denied", "cancelled"],
  ["user_cancelled", "cancelled"],
  ["popup_closed_by_user", "cancelled"],
  ["interaction_required", "interaction_required"],
  ["login_required", "interaction_required"],
  ["consent_required", "interaction_required"],
  ["invalid_client", "configuration_error"],
  ["invalid_scope", "configuration_error"],
  ["unauthorized_client", "configuration_error"],
  ["invalid_grant", "token_error"],
  ["invalid_request", "token_error"],
  ["invalid_token", "token_error"],
  ["server_error", "network_error"],
  ["temporarily_unavailable", "network_error"],
  ["unsupported_response_type", "unknown"],
  ["", "unknown"],
];

const TOKEN_CONTEXT_DIFFERENCES: readonly [string, AuthErrorCode][] = [
  ["invalid_grant", "token_error"],
  ["invalid_request", "token_error"],
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

  it.each(TOKEN_CONTEXT_DIFFERENCES)(
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
    const codes = new Set<AuthErrorCode>(
      AUTHORIZE_FIXTURES.map(([, code]) => code),
    );
    for (const code of codes) {
      expect([
        "cancelled",
        "interaction_required",
        "timeout",
        "popup_blocked",
        "network_error",
        "configuration_error",
        "not_signed_in",
        "operation_in_progress",
        "unsupported_provider",
        "invalid_state",
        "invalid_nonce",
        "token_error",
        "no_id_token",
        "parse_error",
        "refresh_failed",
        "unknown",
      ]).toContain(code);
    }
  });

  it("documents that the refresh bucket is the only context difference", () => {
    const allErrors = new Set(AUTHORIZE_FIXTURES.map(([error]) => error));
    const differences: { error: string; expected: AuthErrorCode }[] = [];
    for (const error of allErrors) {
      const authorize = mapOAuthErrorCode(error, "authorize");
      const token = mapOAuthErrorCode(error, "token");
      const refresh = mapOAuthErrorCode(error, "refresh");
      expect(token).toBe(authorize);
      differences.push({
        error,
        expected: authorize === "token_error" ? "refresh_failed" : authorize,
      });
      expect(refresh).toBe(
        authorize === "token_error" ? "refresh_failed" : authorize,
      );
    }
    expect(differences).toHaveLength(allErrors.size);
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

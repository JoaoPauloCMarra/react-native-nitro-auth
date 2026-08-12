import type { AuthErrorCode } from "../Auth.nitro";

/**
 * Canonical OAuth 2.0 / OIDC error-to-`AuthErrorCode` mapping.
 *
 * This table is the single source of truth for every platform. iOS
 * (`ios/AuthAdapter.swift`), Android (`AuthAdapter.kt`), and web
 * (`Auth.web.ts`) must map identical provider error strings to identical
 * `AuthErrorCode` values. See `docs/error-contract.md` for the documented
 * contract and the fixture corpus.
 */
const OAUTH_ERROR_CODES: Readonly<Record<string, AuthErrorCode>> = {
  access_denied: "cancelled",
  user_cancelled: "cancelled",
  popup_closed_by_user: "cancelled",
  interaction_required: "interaction_required",
  login_required: "interaction_required",
  consent_required: "interaction_required",
  invalid_client: "configuration_error",
  invalid_scope: "configuration_error",
  unauthorized_client: "configuration_error",
  invalid_grant: "token_error",
  invalid_request: "token_error",
  invalid_token: "token_error",
  server_error: "network_error",
  temporarily_unavailable: "network_error",
};

export type OAuthErrorContext = "authorize" | "token" | "refresh";

/**
 * Maps a provider error string to a stable `AuthErrorCode`.
 *
 * `context` selects the operation bucket:
 * - `authorize` and `token` surface token/grant failures as `token_error`;
 * - `refresh` surfaces them as `refresh_failed` so refresh callers can
 *   distinguish a dead grant from a plain token failure.
 *
 * Unknown provider errors map to `unknown`; provider messages are never used
 * as control flow.
 */
export function mapOAuthErrorCode(
  error: string,
  context: OAuthErrorContext = "authorize",
): AuthErrorCode {
  const code = OAUTH_ERROR_CODES[error.trim().toLowerCase()];
  if (code === undefined) {
    return "unknown";
  }
  if (context === "refresh" && code === "token_error") {
    return "refresh_failed";
  }
  return code;
}

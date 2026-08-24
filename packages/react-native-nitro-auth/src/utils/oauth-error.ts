import { OAUTH_ERROR_CODES } from "../generated/oauth-error-codes";
import type { AuthErrorCode } from "../Auth.nitro";

export type OAuthErrorContext = "authorize" | "token" | "refresh";

/**
 * Maps a provider error string to a stable `AuthErrorCode`.
 *
 * The table itself is generated from `scripts/oauth-errors.json` (see
 * `scripts/generate-oauth-errors.ts`); the same source emits the Android
 * (Kotlin) and iOS (Swift) mappings so every platform agrees by construction.
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

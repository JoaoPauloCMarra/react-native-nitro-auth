import type { AuthErrorCode } from "../Auth.nitro";

const AUTH_ERROR_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([
  "cancelled",
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
]);

export function isAuthErrorCode(value: string): value is AuthErrorCode {
  return AUTH_ERROR_CODES.has(value);
}

export function toAuthErrorCode(raw: string): AuthErrorCode {
  if (isAuthErrorCode(raw)) {
    return raw;
  }

  const prefix = raw.split(":", 1)[0]?.trim();
  if (prefix && isAuthErrorCode(prefix)) {
    return prefix;
  }

  return "unknown";
}

/**
 * Typed error thrown by all AuthService operations.
 *
 * - `code` — always a valid `AuthErrorCode`, safe to switch on
 * - `underlyingMessage` — the raw platform message when it differs from `code`
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly underlyingMessage: string | undefined;

  constructor(raw: unknown) {
    const message = raw instanceof Error ? raw.message : String(raw);
    const code = toAuthErrorCode(message);
    super(code);
    this.name = "AuthError";
    this.code = code;
    this.underlyingMessage = code !== message ? message : undefined;
  }

  static from(e: unknown): AuthError {
    return e instanceof AuthError ? e : new AuthError(e);
  }
}

import type { AuthErrorCode } from "../Auth.nitro";

const AUTH_ERROR_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([
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
]);

const LEGACY_AUTH_ERROR_CODES: Readonly<Record<string, AuthErrorCode>> = {
  no_window: "configuration_error",
  disposed: "cancelled",
};

export function isAuthErrorCode(value: string): value is AuthErrorCode {
  return AUTH_ERROR_CODES.has(value);
}

export function toAuthErrorCode(raw: string): AuthErrorCode {
  const normalized = LEGACY_AUTH_ERROR_CODES[raw];
  if (normalized) {
    return normalized;
  }

  if (isAuthErrorCode(raw)) {
    return raw;
  }

  const prefix = raw.split(":", 1)[0]?.trim();
  const normalizedPrefix = prefix ? LEGACY_AUTH_ERROR_CODES[prefix] : undefined;
  if (normalizedPrefix) {
    return normalizedPrefix;
  }

  if (prefix && isAuthErrorCode(prefix)) {
    return prefix;
  }

  return "unknown";
}

/**
 * The auth operation that produced an `AuthError`. Attached at the service
 * boundary so failures carry a stable phase without message parsing.
 */
export type AuthOperation =
  | "login"
  | "requestScopes"
  | "revokeScopes"
  | "revokeAccess"
  | "getAccessToken"
  | "refreshToken"
  | "silentRestore"
  | "logout"
  | "dispose";

export type AuthErrorDetails = {
  code: AuthErrorCode;
  operation?: AuthOperation;
  underlyingMessage?: string;
};

/**
 * Recognizes the structured error envelope produced by web and native
 * boundaries: an object carrying a stable `code` plus an optional raw detail
 * string. Message text is only preserved as `underlyingMessage`; it is never
 * used as control flow when the structured envelope is present.
 */
function parseStructuredEnvelope(value: unknown): AuthErrorDetails | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as {
    code?: unknown;
    underlyingError?: unknown;
    underlyingMessage?: unknown;
  };
  if (typeof candidate.code !== "string" || !isAuthErrorCode(candidate.code)) {
    return undefined;
  }
  const rawDetail =
    typeof candidate.underlyingMessage === "string"
      ? candidate.underlyingMessage
      : typeof candidate.underlyingError === "string"
        ? candidate.underlyingError
        : undefined;
  if (rawDetail === undefined) {
    return { code: candidate.code };
  }
  return { code: candidate.code, underlyingMessage: rawDetail };
}

function parseAuthErrorDetails(raw: unknown): AuthErrorDetails {
  const structured = parseStructuredEnvelope(raw);
  if (structured) {
    return structured;
  }

  const message = raw instanceof Error ? raw.message : String(raw);
  const code = toAuthErrorCode(message);
  if (code !== message) {
    return { code, underlyingMessage: message };
  }
  return { code };
}

/**
 * Typed error thrown by all AuthService operations.
 *
 * - `code` — always a valid `AuthErrorCode`, safe to switch on
 * - `operation` — the phase that failed, attached by the service boundary
 * - `underlyingMessage` — the raw platform message when it differs from `code`
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly operation: AuthOperation | undefined;
  readonly underlyingMessage: string | undefined;

  constructor(raw: unknown, operation?: AuthOperation) {
    const details = parseAuthErrorDetails(raw);
    super(details.code);
    this.name = "AuthError";
    this.code = details.code;
    this.operation = details.operation ?? operation;
    this.underlyingMessage = details.underlyingMessage;
  }

  static from(raw: unknown, operation?: AuthOperation): AuthError {
    return raw instanceof AuthError ? raw : new AuthError(raw, operation);
  }
}

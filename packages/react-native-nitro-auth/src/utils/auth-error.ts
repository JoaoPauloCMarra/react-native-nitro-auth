import type { AuthErrorCode } from "../Auth.nitro";

export const AUTH_ERROR_CODES: Readonly<Record<AuthErrorCode, true>> = {
  cancelled: true,
  interaction_required: true,
  timeout: true,
  popup_blocked: true,
  network_error: true,
  configuration_error: true,
  not_signed_in: true,
  operation_in_progress: true,
  unsupported_provider: true,
  invalid_state: true,
  invalid_nonce: true,
  token_error: true,
  no_id_token: true,
  parse_error: true,
  refresh_failed: true,
  unknown: true,
};

const LEGACY_AUTH_ERROR_CODES: Readonly<Record<string, AuthErrorCode>> = {
  no_window: "configuration_error",
  disposed: "cancelled",
};

const hasOwn = (table: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

export function isAuthErrorCode(value: string): value is AuthErrorCode {
  return hasOwn(AUTH_ERROR_CODES, value);
}

export function toAuthErrorCode(raw: string): AuthErrorCode {
  const normalized = hasOwn(LEGACY_AUTH_ERROR_CODES, raw)
    ? LEGACY_AUTH_ERROR_CODES[raw]
    : undefined;
  if (normalized) {
    return normalized;
  }

  if (isAuthErrorCode(raw)) {
    return raw;
  }

  const prefix = raw.split(":", 1)[0]?.trim();
  const normalizedPrefix =
    prefix && hasOwn(LEGACY_AUTH_ERROR_CODES, prefix)
      ? LEGACY_AUTH_ERROR_CODES[prefix]
      : undefined;
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
  | "createNonce"
  | "getCredential"
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
    if (
      raw instanceof AuthError &&
      (raw.operation !== undefined || operation === undefined)
    )
      return raw;
    return new AuthError(raw, operation);
  }
}

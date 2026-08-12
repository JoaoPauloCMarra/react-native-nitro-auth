import { mapOAuthErrorCode, type OAuthErrorContext } from "./oauth-error";
import type { AuthErrorCode, AuthTokens } from "../Auth.nitro";

/**
 * OAuth token-endpoint contract shared by every platform.
 *
 * The web implementation uses these helpers directly. iOS
 * (`AuthAdapter.swift`) and Android (`AuthAdapter.kt`) build identical
 * request bodies and parse identical responses; `docs/error-contract.md`
 * documents the fixture corpus both must satisfy.
 */

export type AuthorizationCodeRequest = {
  tokenUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
};

export type RefreshTokenRequest = {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
};

export function buildAuthorizationCodeBody(
  request: AuthorizationCodeRequest,
): URLSearchParams {
  return new URLSearchParams({
    client_id: request.clientId,
    code: request.code,
    redirect_uri: request.redirectUri,
    grant_type: "authorization_code",
    code_verifier: request.codeVerifier,
  });
}

export function buildRefreshTokenBody(
  request: RefreshTokenRequest,
): URLSearchParams {
  return new URLSearchParams({
    client_id: request.clientId,
    grant_type: "refresh_token",
    refresh_token: request.refreshToken,
  });
}

/**
 * Converts an `expires_in` seconds value to an epoch-milliseconds expiry.
 * The result is always the access-token expiry (see `docs/error-contract.md`).
 */
export function parseExpiresInMilliseconds(
  value: unknown,
  now: number = Date.now(),
): number | undefined {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : undefined;

  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate < 0
  ) {
    return undefined;
  }

  return now + candidate * 1000;
}

export type TokenResponseParseResult =
  | { ok: true; tokens: AuthTokens }
  | {
      ok: false;
      errorCode: AuthErrorCode;
      underlyingMessage?: string;
    };

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Parses a token-endpoint JSON response. Provider `error` fields map through
 * the canonical OAuth table; `context` selects `token_error` versus
 * `refresh_failed` semantics. Token fields and expiry are extracted into the
 * shared `AuthTokens` shape.
 */
export function parseTokenResponse(
  json: unknown,
  context: OAuthErrorContext = "token",
): TokenResponseParseResult {
  if (!isJsonObject(json)) {
    return {
      ok: false,
      errorCode: "parse_error",
      underlyingMessage: "Expected JSON object response from token endpoint",
    };
  }

  if (typeof json.error === "string" && json.error.length > 0) {
    const providerError = json.error;
    const underlyingMessage =
      typeof json.error_description === "string"
        ? json.error_description
        : providerError;
    return {
      ok: false,
      errorCode: mapOAuthErrorCode(providerError, context),
      underlyingMessage,
    };
  }

  const tokens: AuthTokens = {};
  if (typeof json.id_token === "string") {
    tokens.idToken = json.id_token;
  }
  if (typeof json.access_token === "string") {
    tokens.accessToken = json.access_token;
  }
  if (typeof json.refresh_token === "string") {
    tokens.refreshToken = json.refresh_token;
  }
  const expirationTime = parseExpiresInMilliseconds(json.expires_in);
  if (expirationTime !== undefined) {
    tokens.expirationTime = expirationTime;
  }
  return { ok: true, tokens };
}

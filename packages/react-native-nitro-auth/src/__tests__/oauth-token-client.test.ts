import {
  buildAuthorizationCodeBody,
  buildRefreshTokenBody,
  parseExpiresInMilliseconds,
  parseTokenResponse,
} from "../utils/oauth-token-client";

const REQUEST_FIXTURES = {
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  clientId: "test-client-id",
  code: "auth-code",
  redirectUri: "msauth://com.example/app",
  codeVerifier: "verifier-0123456789abcdef",
  refreshToken: "refresh-token-0123456789abcdef",
} as const;

describe("buildAuthorizationCodeBody", () => {
  it("builds the PKCE exchange body from the shared contract", () => {
    const body = buildAuthorizationCodeBody(REQUEST_FIXTURES);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe(REQUEST_FIXTURES.clientId);
    expect(body.get("code")).toBe(REQUEST_FIXTURES.code);
    expect(body.get("redirect_uri")).toBe(REQUEST_FIXTURES.redirectUri);
    expect(body.get("code_verifier")).toBe(REQUEST_FIXTURES.codeVerifier);
  });

  it("URL-encodes reserved characters in every parameter", () => {
    const body = buildAuthorizationCodeBody({
      ...REQUEST_FIXTURES,
      redirectUri: "msauth://com.example/app?source=a+b",
    });
    expect(body.toString()).toContain(
      "redirect_uri=msauth%3A%2F%2Fcom.example%2Fapp%3Fsource%3Da%2Bb",
    );
  });
});

describe("buildRefreshTokenBody", () => {
  it("builds the refresh body from the shared contract", () => {
    const body = buildRefreshTokenBody(REQUEST_FIXTURES);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(REQUEST_FIXTURES.clientId);
    expect(body.get("refresh_token")).toBe(REQUEST_FIXTURES.refreshToken);
    expect(body.get("code")).toBeNull();
  });
});

describe("parseExpiresInMilliseconds", () => {
  const NOW = 1_700_000_000_000;

  it("converts numeric expires_in seconds to epoch milliseconds", () => {
    expect(parseExpiresInMilliseconds(3600, NOW)).toBe(NOW + 3600_000);
  });

  it("accepts numeric strings", () => {
    expect(parseExpiresInMilliseconds("3600", NOW)).toBe(NOW + 3600_000);
  });

  it("rejects negative, invalid, and missing values", () => {
    expect(parseExpiresInMilliseconds(-1, NOW)).toBeUndefined();
    expect(parseExpiresInMilliseconds("not-a-number", NOW)).toBeUndefined();
    expect(parseExpiresInMilliseconds(undefined, NOW)).toBeUndefined();
    expect(parseExpiresInMilliseconds("", NOW)).toBeUndefined();
  });
});

describe("parseTokenResponse", () => {
  it("extracts tokens and the access-token expiry on success", () => {
    const result = parseTokenResponse(
      {
        id_token: "id-token",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      },
      "token",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual({
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expirationTime: expect.any(Number),
    });
  });

  it("returns partial tokens when optional fields are absent", () => {
    const result = parseTokenResponse(
      { access_token: "access-token" },
      "token",
    );
    expect(result).toEqual({
      ok: true,
      tokens: { accessToken: "access-token" },
    });
  });

  it.each([
    ["invalid_grant", "token"],
    ["invalid_request", "token"],
  ])("maps %s to token_error in the token context", (error, context) => {
    const result = parseTokenResponse({ error }, context as "token");
    expect(result).toMatchObject({ ok: false, errorCode: "token_error" });
  });

  it("maps invalid_scope to configuration_error in the token context", () => {
    const result = parseTokenResponse({ error: "invalid_scope" }, "token");
    expect(result).toMatchObject({
      ok: false,
      errorCode: "configuration_error",
    });
  });

  it("maps grant failures to refresh_failed in the refresh context", () => {
    const result = parseTokenResponse({ error: "invalid_grant" }, "refresh");
    expect(result).toMatchObject({
      ok: false,
      errorCode: "refresh_failed",
      underlyingMessage: "invalid_grant",
    });
  });

  it("prefers error_description as the safe detail", () => {
    const result = parseTokenResponse(
      { error: "invalid_grant", error_description: "The grant is expired" },
      "refresh",
    );
    expect(result).toMatchObject({
      ok: false,
      errorCode: "refresh_failed",
      underlyingMessage: "The grant is expired",
    });
  });

  it("maps server errors to network_error regardless of context", () => {
    for (const context of ["token", "refresh"] as const) {
      expect(
        parseTokenResponse({ error: "temporarily_unavailable" }, context),
      ).toMatchObject({ ok: false, errorCode: "network_error" });
    }
  });

  it("rejects non-object bodies with parse_error", () => {
    expect(parseTokenResponse("not json", "token")).toMatchObject({
      ok: false,
      errorCode: "parse_error",
    });
    expect(parseTokenResponse(null, "token")).toMatchObject({
      ok: false,
      errorCode: "parse_error",
    });
  });
});

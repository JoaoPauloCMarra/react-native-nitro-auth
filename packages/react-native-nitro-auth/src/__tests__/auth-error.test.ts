import {
  AuthError,
  isAuthErrorCode,
  toAuthErrorCode,
} from "../utils/auth-error";

const VALID_CODES = [
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
] as const;

describe("isAuthErrorCode", () => {
  it.each(VALID_CODES)("returns true for '%s'", (code) => {
    expect(isAuthErrorCode(code)).toBe(true);
  });

  it("returns false for arbitrary strings", () => {
    expect(isAuthErrorCode("not_a_code")).toBe(false);
    expect(isAuthErrorCode("CANCELLED")).toBe(false);
    expect(isAuthErrorCode("cancel")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAuthErrorCode("")).toBe(false);
  });
});

describe("toAuthErrorCode", () => {
  it("returns input when valid code", () => {
    expect(toAuthErrorCode("cancelled")).toBe("cancelled");
    expect(toAuthErrorCode("network_error")).toBe("network_error");
  });

  it("returns 'unknown' for invalid string", () => {
    expect(toAuthErrorCode("bogus")).toBe("unknown");
  });

  it("returns 'unknown' for empty string", () => {
    expect(toAuthErrorCode("")).toBe("unknown");
  });
});

describe("AuthError", () => {
  describe("constructor", () => {
    it("sets code and message for known error code string", () => {
      const err = new AuthError("cancelled");
      expect(err.code).toBe("cancelled");
      expect(err.message).toBe("cancelled");
      expect(err.underlyingMessage).toBeUndefined();
    });

    it("sets code='unknown' and underlyingMessage for unknown message", () => {
      const err = new AuthError("something went wrong");
      expect(err.code).toBe("unknown");
      expect(err.message).toBe("unknown");
      expect(err.underlyingMessage).toBe("something went wrong");
    });

    it("wraps Error with known code in message", () => {
      const err = new AuthError(new Error("network_error"));
      expect(err.code).toBe("network_error");
      expect(err.underlyingMessage).toBeUndefined();
    });

    it("wraps Error with unknown message", () => {
      const err = new AuthError(new Error("fetch failed"));
      expect(err.code).toBe("unknown");
      expect(err.underlyingMessage).toBe("fetch failed");
    });

    it("wraps non-Error input: string", () => {
      const err = new AuthError("timeout");
      expect(err.code).toBe("timeout");
    });

    it("wraps non-Error input: number", () => {
      const err = new AuthError(42);
      expect(err.code).toBe("unknown");
      expect(err.underlyingMessage).toBe("42");
    });

    it("wraps non-Error input: null", () => {
      const err = new AuthError(null);
      expect(err.code).toBe("unknown");
      expect(err.underlyingMessage).toBe("null");
    });

    it("wraps non-Error input: undefined", () => {
      const err = new AuthError(undefined);
      expect(err.code).toBe("unknown");
      expect(err.underlyingMessage).toBe("undefined");
    });

    it("wraps non-Error input: object with toString", () => {
      const obj = { toString: () => "token_error" };
      const err = new AuthError(obj);
      expect(err.code).toBe("token_error");
      expect(err.underlyingMessage).toBeUndefined();
    });
  });

  it("name is always 'AuthError'", () => {
    expect(new AuthError("cancelled").name).toBe("AuthError");
    expect(new AuthError("oops").name).toBe("AuthError");
    expect(AuthError.from(new Error("x")).name).toBe("AuthError");
  });

  describe("from", () => {
    it("returns same instance when input is already AuthError", () => {
      const original = new AuthError("cancelled");
      expect(AuthError.from(original)).toBe(original);
    });

    it("wraps plain Error", () => {
      const result = AuthError.from(new Error("network_error"));
      expect(result).toBeInstanceOf(AuthError);
      expect(result.code).toBe("network_error");
    });

    it("wraps string", () => {
      const result = AuthError.from("parse_error");
      expect(result).toBeInstanceOf(AuthError);
      expect(result.code).toBe("parse_error");
    });

    it("wraps null", () => {
      const result = AuthError.from(null);
      expect(result).toBeInstanceOf(AuthError);
      expect(result.code).toBe("unknown");
    });

    it("wraps undefined", () => {
      const result = AuthError.from(undefined);
      expect(result).toBeInstanceOf(AuthError);
      expect(result.code).toBe("unknown");
    });
  });
});

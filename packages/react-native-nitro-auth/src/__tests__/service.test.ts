import { NitroModules } from "react-native-nitro-modules";
import { createAuthService } from "../create-auth-service";
import { AuthService } from "../service";
import { AuthError } from "../utils/auth-error";
import type { AuthTokens, AuthUser } from "../Auth.nitro";

const createJwtWithPayload = (payload: Record<string, unknown>) => {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.sig`;
};

let mockCurrentUser: AuthUser | undefined;
const mockGetCurrentUser = jest.fn(() => mockCurrentUser);
let onAuthStateChangedCallback: ((user: AuthUser | undefined) => void) | null =
  null;
type MockHybridObject = {
  name: string;
  readonly currentUser: AuthUser | undefined;
  grantedScopes: string[];
  hasPlayServices: boolean;
  createNonce: jest.Mock;
  login: jest.Mock;
  logout: jest.Mock;
  requestScopes: jest.Mock;
  revokeScopes: jest.Mock;
  revokeAccess: jest.Mock;
  getAccessToken: jest.Mock;
  refreshToken: jest.Mock;
  onAuthStateChanged: jest.Mock;
  onTokensRefreshed: jest.Mock;
  onAuthEvent: jest.Mock;
  silentRestore: jest.Mock;
  setLoggingEnabled: jest.Mock;
  dispose: jest.Mock;
  equals: jest.Mock;
};

jest.mock("react-native-nitro-modules", () => {
  const hybridObject: MockHybridObject = {
    name: "Auth",
    get currentUser() {
      return mockGetCurrentUser();
    },
    grantedScopes: [],
    hasPlayServices: true,
    createNonce: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    requestScopes: jest.fn(),
    revokeScopes: jest.fn(),
    revokeAccess: jest.fn(),
    getAccessToken: jest.fn(),
    refreshToken: jest.fn(),
    silentRestore: jest.fn(),
    onAuthStateChanged: jest.fn(
      (callback: (user: AuthUser | undefined) => void) => {
        onAuthStateChangedCallback = callback;
        return jest.fn();
      },
    ),
    onTokensRefreshed: jest.fn((_callback: (tokens: AuthTokens) => void) =>
      jest.fn(),
    ),
    onAuthEvent: jest.fn((_callback: (event: unknown) => void) => jest.fn()),
    setLoggingEnabled: jest.fn(),
    dispose: jest.fn(),
    equals: jest.fn(),
  };
  return {
    NitroModules: {
      createHybridObject: jest.fn(() => hybridObject),
    },
  };
});

describe("AuthService", () => {
  function native() {
    const results = (NitroModules.createHybridObject as jest.Mock).mock.results;
    const result = results.at(-1);

    if (!result) {
      throw new Error("Auth hybrid object was not created");
    }

    return result.value as MockHybridObject;
  }

  beforeEach(() => {
    void AuthService.currentUser;
    mockCurrentUser = undefined;
    mockGetCurrentUser.mockReset();
    mockGetCurrentUser.mockImplementation(() => mockCurrentUser);
    onAuthStateChangedCallback = null;
    const hybridObject = native();
    if (hybridObject) {
      hybridObject.login.mockReset();
      hybridObject.createNonce.mockReset();
      hybridObject.logout.mockReset();
      hybridObject.requestScopes.mockReset();
      hybridObject.revokeScopes.mockReset();
      hybridObject.revokeAccess.mockReset();
      hybridObject.getAccessToken.mockReset();
      hybridObject.refreshToken.mockReset();
      hybridObject.silentRestore.mockReset();
      hybridObject.onAuthStateChanged.mockReset();
      hybridObject.onTokensRefreshed.mockReset();
      hybridObject.onAuthEvent.mockReset();
      hybridObject.setLoggingEnabled.mockReset();
      hybridObject.dispose.mockReset();
      hybridObject.equals.mockReset();
      hybridObject.onAuthStateChanged.mockImplementation(
        (callback: (user: AuthUser | undefined) => void) => {
          onAuthStateChangedCallback = callback;
          return jest.fn();
        },
      );
      hybridObject.onTokensRefreshed.mockImplementation(
        (_callback: (tokens: AuthTokens) => void) => jest.fn(),
      );
      hybridObject.onAuthEvent.mockImplementation(
        (_callback: (event: unknown) => void) => jest.fn(),
      );
    }
  });

  it("should create hybrid object with correct name", () => {
    expect(NitroModules.createHybridObject).toHaveBeenCalledWith("Auth");
  });

  it("should export AuthService", () => {
    expect(AuthService).toBeDefined();
  });

  it("should have all required methods", () => {
    expect(AuthService.login).toBeDefined();
    expect(AuthService.loginAndGetUser).toBeDefined();
    expect(AuthService.getCredential).toBeDefined();
    expect(AuthService.logout).toBeDefined();
    expect(AuthService.requestScopes).toBeDefined();
    expect(AuthService.revokeScopes).toBeDefined();
    expect(AuthService.revokeAccess).toBeDefined();
    expect(AuthService.getAccessToken).toBeDefined();
    expect(AuthService.refreshToken).toBeDefined();
  });

  it("should have all required getters", () => {
    expect("currentUser" in AuthService).toBe(true);
    expect("grantedScopes" in AuthService).toBe(true);
    expect("hasPlayServices" in AuthService).toBe(true);
  });

  it("should forward listener payload without reading currentUser again", () => {
    const callback = jest.fn();
    AuthService.onAuthStateChanged(callback);

    const eventUser: AuthUser = {
      provider: "google",
      email: "from-event@example.com",
    };
    onAuthStateChangedCallback?.(eventUser);

    expect(callback).toHaveBeenCalledWith(eventUser);
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  describe("error wrapping", () => {
    it("login wraps native error in AuthError", async () => {
      native().login.mockRejectedValueOnce(new Error("network_error"));
      const error = await AuthService.login("google").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("network_error");
    });

    it("loginAndGetUser returns currentUser after login", async () => {
      const user: AuthUser = {
        provider: "google",
        idToken: "id-token",
      };
      native().login.mockResolvedValueOnce(undefined);
      mockCurrentUser = user;

      await expect(AuthService.loginAndGetUser("google")).resolves.toEqual(
        user,
      );
      expect(native().login).toHaveBeenCalledWith("google", undefined);
    });

    it("loginAndGetUser throws not_signed_in when login leaves currentUser empty", async () => {
      native().login.mockResolvedValueOnce(undefined);
      mockCurrentUser = undefined;

      const error = await AuthService.loginAndGetUser("google").catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("not_signed_in");
      expect((error as AuthError).operation).toBe("login");
    });

    it("loginAndGetUser wraps native login errors in AuthError", async () => {
      native().login.mockRejectedValueOnce(new Error("cancelled"));
      const error = await AuthService.loginAndGetUser("google").catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("cancelled");
    });

    it("requestScopes wraps native error in AuthError", async () => {
      native().requestScopes.mockRejectedValueOnce(new Error("cancelled"));
      const error = await AuthService.requestScopes(["email"]).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("cancelled");
    });

    it("revokeScopes wraps native error in AuthError", async () => {
      native().revokeScopes.mockRejectedValueOnce(new Error("token_error"));
      const error = await AuthService.revokeScopes(["email"]).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("token_error");
    });

    it("getAccessToken wraps native error in AuthError", async () => {
      native().getAccessToken.mockRejectedValueOnce(new Error("no_id_token"));
      const error = await AuthService.getAccessToken().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("no_id_token");
    });

    it("revokeAccess wraps native error in AuthError", async () => {
      native().revokeAccess.mockRejectedValueOnce(new Error("network_error"));
      const error = await AuthService.revokeAccess().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("network_error");
    });

    it("refreshToken wraps native error in AuthError", async () => {
      native().refreshToken.mockRejectedValueOnce(new Error("refresh_failed"));
      const error = await AuthService.refreshToken().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("refresh_failed");
    });

    it("silentRestore wraps native error in AuthError", async () => {
      native().silentRestore.mockRejectedValueOnce(
        new Error("configuration_error"),
      );
      const error = await AuthService.silentRestore().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("configuration_error");
    });

    it("does not double-wrap existing AuthError", async () => {
      const original = new AuthError(new Error("cancelled"));
      native().login.mockRejectedValueOnce(original);
      const error = await AuthService.login("google").catch((e: unknown) => e);
      expect(error).toBe(original);
      expect((error as AuthError).code).toBe("cancelled");
    });

    it("wraps sync native method errors in AuthError", () => {
      native().logout.mockImplementationOnce(() => {
        throw new Error("not_signed_in");
      });

      let error: unknown;
      try {
        AuthService.logout();
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("not_signed_in");
    });

    it("wraps dispose native errors in AuthError", () => {
      native().dispose.mockImplementationOnce(() => {
        throw new Error("configuration_error");
      });

      let error: unknown;
      try {
        AuthService.dispose();
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("configuration_error");
    });

    it("wraps equals native errors in AuthError", () => {
      native().equals.mockImplementationOnce(() => {
        throw new Error("unknown");
      });

      let error: unknown;
      try {
        AuthService.equals(native());
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("unknown");
    });

    it("wraps sync native getter errors in AuthError", () => {
      mockGetCurrentUser.mockImplementationOnce(() => {
        throw new Error("configuration_error");
      });

      let error: unknown;
      try {
        void AuthService.currentUser;
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("configuration_error");
    });
  });

  describe("silentRestore", () => {
    it("resolves on success", async () => {
      native().silentRestore.mockResolvedValueOnce(undefined);
      await expect(AuthService.silentRestore()).resolves.toBeUndefined();
    });
  });

  it("recreates the native hybrid object after disposal", () => {
    const creationCount = (NitroModules.createHybridObject as jest.Mock).mock
      .calls.length;

    AuthService.dispose();
    void AuthService.currentUser;

    expect(NitroModules.createHybridObject).toHaveBeenCalledTimes(
      creationCount + 1,
    );
  });

  describe("setLoggingEnabled", () => {
    it("forwards boolean to native module", () => {
      AuthService.setLoggingEnabled(true);
      expect(native().setLoggingEnabled).toHaveBeenCalledWith(true);

      AuthService.setLoggingEnabled(false);
      expect(native().setLoggingEnabled).toHaveBeenCalledWith(false);
    });
  });

  it("maps operation_in_progress as a structured AuthError code", async () => {
    native().login.mockRejectedValueOnce(new Error("operation_in_progress"));

    const error = await AuthService.login("google").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe("operation_in_progress");
  });

  it("forwards every synchronous Auth member through the service factory", () => {
    const auth = native();
    auth.grantedScopes = ["email"];
    auth.hasPlayServices = false;
    auth.logout.mockClear();
    auth.revokeAccess.mockClear();
    auth.setLoggingEnabled.mockClear();
    auth.dispose.mockClear();
    auth.equals.mockClear();
    auth.equals.mockReturnValueOnce(true);

    const service = createAuthService(() => auth);
    const unsubscribeAuth = jest.fn();
    const unsubscribeTokens = jest.fn();
    auth.onAuthStateChanged.mockReturnValueOnce(unsubscribeAuth);
    auth.onTokensRefreshed.mockReturnValueOnce(unsubscribeTokens);

    const authCallback = jest.fn();
    const tokenCallback = jest.fn();

    expect(service.name).toBe("Auth");
    expect(service.currentUser).toBeUndefined();
    expect(service.grantedScopes).toEqual(["email"]);
    expect(service.hasPlayServices).toBe(false);
    expect(service.onAuthStateChanged(authCallback)).toBe(unsubscribeAuth);
    expect(service.onTokensRefreshed(tokenCallback)).toBe(unsubscribeTokens);
    service.logout();
    void service.revokeAccess();
    service.setLoggingEnabled(true);
    service.dispose();
    expect(service.equals(auth)).toBe(true);

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(auth.revokeAccess).toHaveBeenCalledTimes(1);
    expect(auth.setLoggingEnabled).toHaveBeenCalledWith(true);
    expect(auth.dispose).toHaveBeenCalledTimes(1);
    expect(auth.equals).toHaveBeenCalledWith(auth);
  });

  it("normalizes optional native members that older native builds may omit", async () => {
    const auth = native();
    auth.logout.mockClear();
    const partialAuth = {
      ...auth,
      grantedScopes: undefined,
      onAuthStateChanged: undefined,
      onTokensRefreshed: undefined,
      onAuthEvent: undefined,
      revokeAccess: undefined,
      setLoggingEnabled: undefined,
    } as unknown as MockHybridObject;
    const service = createAuthService(() => partialAuth);

    expect(service.grantedScopes).toEqual([]);
    expect(service.onAuthStateChanged(jest.fn())).toEqual(expect.any(Function));
    expect(service.onTokensRefreshed(jest.fn())).toEqual(expect.any(Function));
    expect(service.onAuthEvent(jest.fn())).toEqual(expect.any(Function));
    expect(() => {
      service.setLoggingEnabled(true);
    }).not.toThrow();
    await expect(service.revokeAccess()).rejects.toMatchObject({
      code: "configuration_error",
    });
    expect(auth.logout).not.toHaveBeenCalled();
  });

  describe("error envelope", () => {
    it.each([
      ["login", "network_error"],
      ["requestScopes", "cancelled"],
      ["revokeScopes", "token_error"],
      ["revokeAccess", "network_error"],
      ["getAccessToken", "no_id_token"],
      ["refreshToken", "refresh_failed"],
      ["silentRestore", "configuration_error"],
    ] as const)(
      "attaches the %s operation to wrapped failures",
      async (operation, code) => {
        native()[operation].mockRejectedValueOnce(new Error(code));
        const run = () => {
          switch (operation) {
            case "login":
              return AuthService.login("google");
            case "requestScopes":
              return AuthService.requestScopes(["email"]);
            case "revokeScopes":
              return AuthService.revokeScopes(["email"]);
            case "revokeAccess":
              return AuthService.revokeAccess();
            case "getAccessToken":
              return AuthService.getAccessToken();
            case "refreshToken":
              return AuthService.refreshToken();
            case "silentRestore":
              return AuthService.silentRestore();
          }
        };
        const error = await run().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe(code);
        expect((error as AuthError).operation).toBe(operation);
      },
    );

    it("preserves the underlying message from native envelopes", async () => {
      native().refreshToken.mockRejectedValueOnce(
        new Error("refresh_failed: invalid_grant"),
      );
      const error = await AuthService.refreshToken().catch((e: unknown) => e);
      expect((error as AuthError).code).toBe("refresh_failed");
      expect((error as AuthError).underlyingMessage).toBe(
        "refresh_failed: invalid_grant",
      );
      expect((error as AuthError).operation).toBe("refreshToken");
    });
  });

  describe("getCredential", () => {
    const rawNonce = "raw-credential-nonce";
    const hashedNonce = "a".repeat(64);
    const idToken = createJwtWithPayload({ nonce: hashedNonce });

    it("returns a copied nonce-bound Google credential and cleans the temporary session", async () => {
      const user: AuthUser = {
        provider: "google",
        email: "credential@example.com",
        firstName: "Jane",
        lastName: "Doe",
        scopes: ["openid", "email", "profile"],
        idToken,
      };
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockImplementationOnce(
        async (_provider: string, options: Record<string, unknown>) => {
          expect(options).toEqual({
            forceAccountPicker: true,
            scopes: ["openid", "email", "profile"],
            nonce: hashedNonce,
          });
          mockCurrentUser = user;
        },
      );

      const result = await AuthService.getCredential("google", {
        forceAccountPicker: true,
      });

      expect(result).toEqual({
        provider: "google",
        idToken,
        nonce: rawNonce,
        user,
      });
      expect(result.user).not.toBe(user);
      expect(result.user.scopes).not.toBe(user.scopes);
      expect(native().createNonce).toHaveBeenCalledTimes(1);
      expect(native().login).toHaveBeenCalledTimes(1);
      expect(native().logout).toHaveBeenCalledTimes(1);
    });

    it("uses Apple credential scopes and preserves an explicit override", async () => {
      const user: AuthUser = { provider: "apple", idToken };
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockImplementationOnce(
        async (_provider: string, options: Record<string, unknown>) => {
          expect(options).toEqual({ scopes: ["email"], nonce: hashedNonce });
          mockCurrentUser = user;
        },
      );

      await expect(
        AuthService.getCredential("apple", { scopes: ["email"] }),
      ).resolves.toMatchObject({ provider: "apple", nonce: rawNonce });
    });

    it("uses Apple credential defaults when the caller omits scopes", async () => {
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockImplementationOnce(
        async (_provider: string, options: Record<string, unknown>) => {
          expect(options).toEqual({
            scopes: ["email", "fullName"],
            nonce: hashedNonce,
          });
          mockCurrentUser = { provider: "apple", idToken };
        },
      );

      await expect(AuthService.getCredential("apple")).resolves.toMatchObject({
        provider: "apple",
        nonce: rawNonce,
      });
    });

    it.each(["success", "cancel", "failure"] as const)(
      "rejects a pre-existing package session before %s provider setup",
      async (providerResult) => {
        const existingUser: AuthUser = {
          provider: "google",
          email: "existing@example.com",
          idToken: "existing-id-token",
        };
        mockCurrentUser = existingUser;
        const auth = native();
        auth.createNonce.mockResolvedValueOnce({
          raw: rawNonce,
          hashed: hashedNonce,
        });
        auth.login.mockImplementationOnce(async () => {
          if (providerResult === "success") {
            mockCurrentUser = { provider: "apple", idToken };
            onAuthStateChangedCallback?.(mockCurrentUser);
            return;
          }
          throw new Error(
            providerResult === "cancel" ? "cancelled" : "network_error",
          );
        });
        auth.logout.mockImplementationOnce(() => {
          mockCurrentUser = undefined;
          onAuthStateChangedCallback?.(undefined);
        });
        const userListener = jest.fn();
        const unsubscribe = AuthService.onAuthStateChanged(userListener);

        await expect(AuthService.getCredential("apple")).rejects.toMatchObject({
          code: "invalid_state",
          operation: "getCredential",
        });

        expect(auth.createNonce).not.toHaveBeenCalled();
        expect(auth.login).not.toHaveBeenCalled();
        expect(auth.logout).not.toHaveBeenCalled();
        expect(AuthService.currentUser).toBe(existingUser);
        expect(userListener).not.toHaveBeenCalled();
        unsubscribe();
      },
    );

    it("rejects a credential whose ID token nonce does not match and still cleans the session", async () => {
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockRejectedValueOnce(new Error("invalid_nonce"));

      await expect(AuthService.getCredential("google")).rejects.toMatchObject({
        code: "invalid_nonce",
        operation: "getCredential",
      });
      expect(native().logout).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid native credential result and cleans the session", async () => {
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockImplementationOnce(async () => {
        mockCurrentUser = { provider: "google" };
      });

      await expect(AuthService.getCredential("google")).rejects.toMatchObject({
        code: "no_id_token",
        operation: "getCredential",
      });
      expect(native().logout).toHaveBeenCalledTimes(1);
    });

    it("rejects malformed nonce material before starting provider login", async () => {
      native().createNonce.mockResolvedValueOnce({ raw: "", hashed: "bad" });

      await expect(AuthService.getCredential("google")).rejects.toMatchObject({
        code: "invalid_nonce",
        operation: "getCredential",
      });
      expect(native().login).not.toHaveBeenCalled();
      expect(native().logout).not.toHaveBeenCalled();
    });

    it("preserves the primary credential error when cleanup also fails", async () => {
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockRejectedValueOnce(new Error("network_error"));
      native().logout.mockImplementationOnce(() => {
        throw new Error("configuration_error");
      });

      await expect(AuthService.getCredential("google")).rejects.toMatchObject({
        code: "network_error",
        operation: "getCredential",
      });
    });

    it("normalizes a cleanup error when credential acquisition succeeds", async () => {
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockImplementationOnce(async () => {
        mockCurrentUser = { provider: "google", idToken };
      });
      native().logout.mockImplementationOnce(() => {
        throw new Error("configuration_error");
      });

      await expect(AuthService.getCredential("google")).rejects.toMatchObject({
        code: "configuration_error",
        operation: "getCredential",
      });
    });

    it("rejects concurrent credential acquisition before starting a second native flow", async () => {
      let resolveNonce:
        ((value: { raw: string; hashed: string }) => void) | undefined;
      native().createNonce.mockImplementationOnce(
        () =>
          new Promise<{ raw: string; hashed: string }>((resolve) => {
            resolveNonce = resolve;
          }),
      );

      const first = AuthService.getCredential("google");
      await expect(AuthService.getCredential("apple")).rejects.toMatchObject({
        code: "operation_in_progress",
        operation: "getCredential",
      });

      resolveNonce?.({ raw: rawNonce, hashed: hashedNonce });
      native().login.mockImplementationOnce(async () => {
        mockCurrentUser = { provider: "google", idToken };
      });
      await expect(first).resolves.toMatchObject({ nonce: rawNonce });
      expect(native().login).toHaveBeenCalledTimes(1);
    });

    it("blocks a newer service login until credential cleanup completes", async () => {
      let resolveLogin: (() => void) | undefined;
      native().createNonce.mockResolvedValueOnce({
        raw: rawNonce,
        hashed: hashedNonce,
      });
      native().login.mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveLogin = resolve)),
      );

      const credential = AuthService.getCredential("google");
      await expect(AuthService.login("apple")).rejects.toMatchObject({
        code: "operation_in_progress",
        operation: "login",
      });
      await expect(AuthService.loginAndGetUser("apple")).rejects.toMatchObject({
        code: "operation_in_progress",
        operation: "login",
      });

      mockCurrentUser = { provider: "google", idToken };
      resolveLogin?.();
      await expect(credential).resolves.toMatchObject({ nonce: rawNonce });
      expect(native().logout).toHaveBeenCalledTimes(1);
      expect(native().login).toHaveBeenCalledTimes(1);
    });

    it("rejects credential acquisition while a service login is already active", async () => {
      let resolveLogin: (() => void) | undefined;
      native().login.mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveLogin = resolve)),
      );

      const login = AuthService.login("google");
      await expect(AuthService.getCredential("google")).rejects.toMatchObject({
        code: "operation_in_progress",
        operation: "getCredential",
      });

      expect(native().createNonce).not.toHaveBeenCalled();
      expect(native().logout).not.toHaveBeenCalled();
      resolveLogin?.();
      await expect(login).resolves.toBeUndefined();
    });

    it.each(["logout", "dispose"] as const)(
      "does not start provider login when service %s interrupts nonce creation",
      async (operation) => {
        let resolveNonce:
          ((value: { raw: string; hashed: string }) => void) | undefined;
        const auth = native();
        auth.createNonce.mockImplementationOnce(
          () =>
            new Promise<{ raw: string; hashed: string }>((resolve) => {
              resolveNonce = resolve;
            }),
        );

        const credential = AuthService.getCredential("google");
        if (operation === "logout") {
          AuthService.logout();
        } else {
          AuthService.dispose();
        }
        resolveNonce?.({ raw: rawNonce, hashed: hashedNonce });

        await expect(credential).rejects.toMatchObject({
          code: "cancelled",
          operation: "getCredential",
        });
        expect(auth.login).not.toHaveBeenCalled();
        expect(auth[operation]).toHaveBeenCalledTimes(1);
      },
    );

    it.each(["requestScopes", "silentRestore"] as const)(
      "rejects credential acquisition while %s is active",
      async (operation) => {
        let resolveOperation: (() => void) | undefined;
        const auth = native();
        const pendingOperation = new Promise<void>(
          (resolve) => (resolveOperation = resolve),
        );
        if (operation === "requestScopes") {
          auth.requestScopes.mockReturnValueOnce(pendingOperation);
        } else {
          auth.silentRestore.mockReturnValueOnce(pendingOperation);
        }

        const active =
          operation === "requestScopes"
            ? AuthService.requestScopes(["email"])
            : AuthService.silentRestore();
        await expect(AuthService.getCredential("google")).rejects.toMatchObject(
          {
            code: "operation_in_progress",
            operation: "getCredential",
          },
        );
        expect(auth.createNonce).not.toHaveBeenCalled();
        expect(auth.logout).not.toHaveBeenCalled();

        resolveOperation?.();
        await expect(active).resolves.toBeUndefined();
      },
    );

    it("blocks scope requests and restore during credential acquisition", async () => {
      let resolveNonce:
        ((value: { raw: string; hashed: string }) => void) | undefined;
      const auth = native();
      auth.createNonce.mockImplementationOnce(
        () =>
          new Promise<{ raw: string; hashed: string }>((resolve) => {
            resolveNonce = resolve;
          }),
      );

      const credential = AuthService.getCredential("google");
      await expect(AuthService.requestScopes(["email"])).rejects.toMatchObject({
        code: "operation_in_progress",
        operation: "requestScopes",
      });
      await expect(AuthService.silentRestore()).rejects.toMatchObject({
        code: "operation_in_progress",
        operation: "silentRestore",
      });
      expect(auth.requestScopes).not.toHaveBeenCalled();
      expect(auth.silentRestore).not.toHaveBeenCalled();

      resolveNonce?.({ raw: rawNonce, hashed: hashedNonce });
      auth.login.mockImplementationOnce(async () => {
        mockCurrentUser = { provider: "google", idToken };
      });
      await expect(credential).resolves.toMatchObject({ nonce: rawNonce });
    });

    it("rejects unsupported providers without touching native auth", async () => {
      await expect(
        AuthService.getCredential("microsoft" as never),
      ).rejects.toMatchObject({
        code: "unsupported_provider",
        operation: "getCredential",
      });
      expect(native().createNonce).not.toHaveBeenCalled();
      expect(native().login).not.toHaveBeenCalled();
      expect(native().logout).not.toHaveBeenCalled();
    });
  });

  describe("onAuthEvent", () => {
    it("forwards the typed event callback to the native module", () => {
      const unsubscribe = jest.fn();
      native().onAuthEvent.mockReturnValueOnce(unsubscribe);
      const callback = jest.fn();

      const result = AuthService.onAuthEvent(callback);

      expect(result).toBe(unsubscribe);
      expect(native().onAuthEvent).toHaveBeenCalledWith(callback);
    });
  });

  describe("revokeScopes", () => {
    it("preserves the void result", async () => {
      native().revokeScopes.mockResolvedValueOnce(undefined);
      await expect(
        AuthService.revokeScopes(["email"]),
      ).resolves.toBeUndefined();
    });

    it("exposes the typed result through the additive method", async () => {
      native().grantedScopes = ["email", "profile"];
      native().revokeScopes.mockResolvedValueOnce(undefined);
      await expect(
        AuthService.revokeScopesWithResult(["email"]),
      ).resolves.toEqual({
        revokedAtProvider: false,
        revokedScopes: ["email"],
      });
      expect(native().revokeScopes).toHaveBeenCalledWith(["email"]);
    });
  });
});

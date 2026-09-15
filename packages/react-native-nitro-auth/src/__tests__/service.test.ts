import { NitroModules } from "react-native-nitro-modules";
import { createAuthService } from "../create-auth-service";
import { AuthService } from "../service";
import { AuthError } from "../utils/auth-error";
import type { AuthSessionSnapshot, AuthTokens, AuthUser } from "../Auth.nitro";

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
  getCredential: jest.Mock;
  getSessionSnapshot: jest.Mock;
  onSessionChanged: jest.Mock;
  loginAndGetUser: jest.Mock;
  revokeScopesWithResult: jest.Mock;
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
    getCredential: jest.fn(),
    getSessionSnapshot: jest.fn(),
    onSessionChanged: jest.fn(() => jest.fn()),
    loginAndGetUser: jest.fn(),
    revokeScopesWithResult: jest.fn(),
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
      hybridObject.getCredential.mockReset();
      hybridObject.getSessionSnapshot.mockReset();
      hybridObject.onSessionChanged.mockReset();
      hybridObject.loginAndGetUser.mockReset();
      hybridObject.revokeScopesWithResult.mockReset();
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

    it("loginAndGetUser returns the atomic native result without reading currentUser", async () => {
      const user: AuthUser = {
        provider: "google",
        idToken: "id-token",
      };
      native().loginAndGetUser.mockResolvedValueOnce(user);
      mockCurrentUser = { provider: "apple" };

      await expect(AuthService.loginAndGetUser("google")).resolves.toEqual(
        user,
      );
      expect(native().loginAndGetUser).toHaveBeenCalledWith(
        "google",
        undefined,
      );
    });

    it("loginAndGetUser preserves a native not_signed_in rejection", async () => {
      native().loginAndGetUser.mockRejectedValueOnce(
        new Error("not_signed_in"),
      );
      mockCurrentUser = undefined;

      const error = await AuthService.loginAndGetUser("google").catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("not_signed_in");
      expect((error as AuthError).operation).toBe("login");
    });

    it("loginAndGetUser wraps native login errors in AuthError", async () => {
      native().loginAndGetUser.mockRejectedValueOnce(new Error("cancelled"));
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

    it("does not double-wrap an existing phased AuthError", async () => {
      const original = new AuthError(new Error("cancelled"), "login");
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
    service.onAuthStateChanged(authCallback);
    service.onTokensRefreshed(tokenCallback);
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
    it("delegates one native transaction and preserves its result", async () => {
      const value = {
        provider: "google",
        idToken: "id",
        nonce: "raw",
        user: { provider: "google" },
      };
      native().getCredential.mockResolvedValueOnce(value);
      await expect(
        AuthService.getCredential("google", { forceAccountPicker: true }),
      ).resolves.toBe(value);
      expect(native().getCredential).toHaveBeenCalledWith("google", {
        forceAccountPicker: true,
      });
      expect(native().createNonce).not.toHaveBeenCalled();
      expect(native().login).not.toHaveBeenCalled();
      expect(native().logout).not.toHaveBeenCalled();
      expect(mockGetCurrentUser).not.toHaveBeenCalled();
    });
    it.each([
      "invalid_state",
      "invalid_nonce",
      "no_id_token",
      "cancelled",
      "network_error",
    ])("preserves native %s failures", async (code) => {
      native().getCredential.mockRejectedValueOnce(new Error(code));
      await expect(AuthService.getCredential("apple")).rejects.toMatchObject({
        code,
        operation: "getCredential",
      });
    });
    it("blocks overlapping session work until the native transaction settles", async () => {
      let finish: ((value: unknown) => void) | undefined;
      native().getCredential.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = AuthService.getCredential("google");
      await expect(AuthService.login("google")).rejects.toMatchObject({
        code: "operation_in_progress",
      });
      await expect(AuthService.getCredential("apple")).rejects.toMatchObject({
        code: "operation_in_progress",
      });
      finish?.({
        provider: "google",
        idToken: "id",
        nonce: "raw",
        user: { provider: "google" },
      });
      await pending;
    });
    it("rejects unsupported providers before the native call", async () => {
      await expect(
        AuthService.getCredential("microsoft" as never),
      ).rejects.toMatchObject({ code: "unsupported_provider" });
      expect(native().getCredential).not.toHaveBeenCalled();
    });
  });

  describe("onAuthEvent", () => {
    it("forwards the typed event callback to the native module", () => {
      const unsubscribe = jest.fn();
      native().onAuthEvent.mockReturnValueOnce(unsubscribe);
      const callback = jest.fn();

      const result = AuthService.onAuthEvent(callback);

      const deliver = native().onAuthEvent.mock.calls.at(-1)?.[0];
      deliver({ type: "login_started", provider: "google" });
      expect(callback).toHaveBeenCalledWith({
        type: "login_started",
        provider: "google",
      });
      result();
      result();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
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
      native().revokeScopesWithResult.mockResolvedValueOnce({
        revokedAtProvider: false,
        revokedScopes: ["email"],
      });
      await expect(
        AuthService.revokeScopesWithResult(["email"]),
      ).resolves.toEqual({
        revokedAtProvider: false,
        revokedScopes: ["email"],
      });
      expect(native().revokeScopesWithResult).toHaveBeenCalledWith(["email"]);
    });
  });
  it("suppresses queued callbacks after unsubscribe and makes cleanup idempotent", () => {
    const callback = jest.fn();
    const remove = jest.fn();
    native().onAuthStateChanged.mockImplementationOnce((listener) => {
      onAuthStateChangedCallback = listener;
      return remove;
    });
    const unsubscribe = AuthService.onAuthStateChanged(callback);
    unsubscribe();
    unsubscribe();
    onAuthStateChangedCallback?.({ provider: "google" });
    expect(callback).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("isolates JavaScript listener failures at the service boundary", () => {
    const unsubscribe = AuthService.onAuthStateChanged(() => {
      throw new Error("private callback detail");
    });
    expect(() =>
      onAuthStateChangedCallback?.({ provider: "google" }),
    ).not.toThrow();
    unsubscribe();
  });

  it("suppresses queued callbacks when the service is disposed", () => {
    const callback = jest.fn();
    AuthService.onAuthStateChanged(callback);
    const queued = onAuthStateChangedCallback;
    AuthService.dispose();
    queued?.({ provider: "google" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("correlates operation terminal events without exposing credentials or error details", async () => {
    const events: unknown[] = [];
    const unsubscribe = AuthService.onAuthEvent((event) => events.push(event));
    native().getCredential.mockRejectedValueOnce(
      new Error("network_error: private-provider-detail"),
    );
    await expect(AuthService.getCredential("google")).rejects.toMatchObject({
      code: "network_error",
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "operation_started",
      operation: "getCredential",
      provider: "google",
    });
    expect(events[1]).toMatchObject({
      type: "operation_failed",
      operation: "getCredential",
      errorCode: "network_error",
    });
    expect(JSON.stringify(events)).not.toContain("private-provider-detail");
    expect(events[1]).toMatchObject({
      operationId: (events[0] as { operationId: number }).operationId,
      elapsedMilliseconds: expect.any(Number),
    });
    unsubscribe();
  });
  it("keeps mounted snapshot observers connected after service disposal", () => {
    let callback: ((snapshot: AuthSessionSnapshot) => void) | undefined;
    let snapshot: AuthSessionSnapshot = { revision: 0, scopes: [] };
    const backend = {
      ...native(),
      getSessionSnapshot: jest.fn(() => snapshot),
      onSessionChanged: jest.fn(
        (listener: (value: AuthSessionSnapshot) => void) => {
          callback = listener;
          return jest.fn();
        },
      ),
    };
    const service = createAuthService(() => backend);
    const observer = jest.fn();
    const remove = service.onSessionChanged(observer);
    service.dispose();
    expect(observer.mock.calls.at(-1)?.[0].user).toBeUndefined();
    service.getSessionSnapshot();
    snapshot = { revision: 1, scopes: ["email"], user: { provider: "google" } };
    callback?.(snapshot);
    expect(observer.mock.calls.at(-1)?.[0].user.provider).toBe("google");
    expect(backend.onSessionChanged).toHaveBeenCalledTimes(2);
    remove();
    remove();
  });

  it("does not retain an event listener when native registration fails", async () => {
    const observer = jest.fn();
    native().onAuthEvent.mockImplementationOnce(() => {
      throw new Error("configuration_error");
    });
    expect(() => AuthService.onAuthEvent(observer)).toThrow(AuthError);
    await AuthService.getAccessToken();
    expect(observer).not.toHaveBeenCalled();
  });

  it("does not deliver a snapshot to a listener removed during dispatch", () => {
    let deliver: ((snapshot: AuthSessionSnapshot) => void) | undefined;
    const backend = {
      ...native(),
      getSessionSnapshot: jest.fn(() => ({ revision: 0, scopes: [] })),
      onSessionChanged: jest.fn(
        (listener: (snapshot: AuthSessionSnapshot) => void) => {
          deliver = listener;
          return jest.fn();
        },
      ),
    };
    const service = createAuthService(() => backend);
    let removeSecond: () => void = jest.fn();
    const removeFirst = service.onSessionChanged(() => {
      removeSecond();
    });
    const second = jest.fn();
    removeSecond = service.onSessionChanged(second);
    deliver?.({ revision: 1, scopes: [] });
    expect(second).not.toHaveBeenCalled();
    removeFirst();
  });
});

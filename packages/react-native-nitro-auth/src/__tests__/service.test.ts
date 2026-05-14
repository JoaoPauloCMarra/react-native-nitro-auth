import { NitroModules } from "react-native-nitro-modules";
import { createAuthService } from "../create-auth-service";
import { AuthService } from "../service";
import { AuthError } from "../utils/auth-error";
import type { AuthTokens, AuthUser } from "../Auth.nitro";

let mockCurrentUser: AuthUser | undefined;
const mockGetCurrentUser = jest.fn(() => mockCurrentUser);
let onAuthStateChangedCallback: ((user: AuthUser | undefined) => void) | null =
  null;
type MockHybridObject = {
  name: string;
  readonly currentUser: AuthUser | undefined;
  grantedScopes: string[];
  hasPlayServices: boolean;
  login: jest.Mock;
  logout: jest.Mock;
  requestScopes: jest.Mock;
  revokeScopes: jest.Mock;
  revokeAccess: jest.Mock;
  getAccessToken: jest.Mock;
  refreshToken: jest.Mock;
  onAuthStateChanged: jest.Mock;
  onTokensRefreshed: jest.Mock;
  silentRestore: jest.Mock;
  setLoggingEnabled: jest.Mock;
  dispose: jest.Mock;
  equals: jest.Mock;
};

// eslint-disable-next-line no-var
var mockState: { hybridObject: MockHybridObject | undefined } = {
  hybridObject: undefined,
};

jest.mock("react-native-nitro-modules", () => {
  const hybridObject: MockHybridObject = {
    name: "Auth",
    get currentUser() {
      return mockGetCurrentUser();
    },
    grantedScopes: [],
    hasPlayServices: true,
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
    setLoggingEnabled: jest.fn(),
    dispose: jest.fn(),
    equals: jest.fn(),
  };
  mockState = { hybridObject };

  return {
    NitroModules: {
      createHybridObject: jest.fn(() => hybridObject),
    },
  };
});

describe("AuthService", () => {
  const native = () =>
    (NitroModules.createHybridObject as jest.Mock).mock.results[0]
      .value as MockHybridObject;

  beforeEach(() => {
    void AuthService.currentUser;
    mockCurrentUser = undefined;
    mockGetCurrentUser.mockReset();
    mockGetCurrentUser.mockImplementation(() => mockCurrentUser);
    onAuthStateChangedCallback = null;
    const hybridObject = mockState.hybridObject;
    if (hybridObject) {
      hybridObject.login.mockReset();
      hybridObject.logout.mockReset();
      hybridObject.requestScopes.mockReset();
      hybridObject.revokeScopes.mockReset();
      hybridObject.revokeAccess.mockReset();
      hybridObject.getAccessToken.mockReset();
      hybridObject.refreshToken.mockReset();
      hybridObject.silentRestore.mockReset();
      hybridObject.onAuthStateChanged.mockReset();
      hybridObject.onTokensRefreshed.mockReset();
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

  it("normalizes optional native members that older native builds may omit", () => {
    const auth = native();
    const partialAuth = {
      ...auth,
      grantedScopes: undefined,
      onAuthStateChanged: undefined,
      onTokensRefreshed: undefined,
      setLoggingEnabled: undefined,
    } as unknown as MockHybridObject;
    const service = createAuthService(() => partialAuth);

    expect(service.grantedScopes).toEqual([]);
    expect(service.onAuthStateChanged(jest.fn())).toEqual(expect.any(Function));
    expect(service.onTokensRefreshed(jest.fn())).toEqual(expect.any(Function));
    expect(() => {
      service.setLoggingEnabled(true);
    }).not.toThrow();
  });
});

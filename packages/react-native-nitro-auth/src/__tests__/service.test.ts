import { NitroModules } from "react-native-nitro-modules";
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
  beforeEach(() => {
    mockCurrentUser = undefined;
    mockGetCurrentUser.mockClear();
    onAuthStateChangedCallback = null;
    mockState.hybridObject?.onAuthStateChanged.mockClear();
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
    const native = () =>
      (NitroModules.createHybridObject as jest.Mock).mock.results[0]
        .value as MockHybridObject;

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
  });

  describe("silentRestore", () => {
    const native = () =>
      (NitroModules.createHybridObject as jest.Mock).mock.results[0]
        .value as MockHybridObject;

    it("resolves on success", async () => {
      native().silentRestore.mockResolvedValueOnce(undefined);
      await expect(AuthService.silentRestore()).resolves.toBeUndefined();
    });
  });

  describe("setLoggingEnabled", () => {
    const native = () =>
      (NitroModules.createHybridObject as jest.Mock).mock.results[0]
        .value as MockHybridObject;

    it("forwards boolean to native module", () => {
      AuthService.setLoggingEnabled(true);
      expect(native().setLoggingEnabled).toHaveBeenCalledWith(true);

      AuthService.setLoggingEnabled(false);
      expect(native().setLoggingEnabled).toHaveBeenCalledWith(false);
    });
  });
});

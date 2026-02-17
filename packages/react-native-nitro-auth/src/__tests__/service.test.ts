import { NitroModules } from "react-native-nitro-modules";
import { AuthService } from "../service";

jest.mock("react-native-nitro-modules", () => {
  const mockHybridObject = {
    name: "Auth",
    currentUser: undefined,
    grantedScopes: [],
    hasPlayServices: true,
    login: jest.fn(),
    logout: jest.fn(),
    requestScopes: jest.fn(),
    revokeScopes: jest.fn(),
    getAccessToken: jest.fn(),
    refreshToken: jest.fn(),
    onAuthStateChanged: jest.fn(() => jest.fn()),
    onTokensRefreshed: jest.fn(() => jest.fn()),
    setLoggingEnabled: jest.fn(),
    dispose: jest.fn(),
    equals: jest.fn(),
  };

  return {
    NitroModules: {
      createHybridObject: jest.fn(() => mockHybridObject),
    },
  };
});

describe("AuthService", () => {
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
});

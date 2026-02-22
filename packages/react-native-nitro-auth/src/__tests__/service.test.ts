import { NitroModules } from "react-native-nitro-modules";
import { AuthService } from "../service";
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
});

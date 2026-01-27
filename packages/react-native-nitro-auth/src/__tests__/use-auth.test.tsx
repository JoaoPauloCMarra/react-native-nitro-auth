import { renderHook, act } from "@testing-library/react";
import type { AuthUser } from "../Auth.nitro";

// Module-level mock state
let mockCurrentUser: AuthUser | undefined = undefined;
let mockScopes: string[] = [];

// Mock functions
const mockLogin = jest.fn();
const mockLogout = jest.fn();
const mockRequestScopes = jest.fn();
const mockRevokeScopes = jest.fn();
const mockGetAccessToken = jest.fn();
const mockRefreshToken = jest.fn();
const mockOnAuthStateChanged = jest.fn();
const mockSetStorageAdapter = jest.fn();
const mockOnTokensRefreshed = jest.fn();

// Mock the service module
jest.mock("../service", () => ({
  AuthService: {
    get currentUser() {
      return mockCurrentUser;
    },
    get grantedScopes() {
      return mockScopes;
    },
    get hasPlayServices() {
      return true;
    },
    login: (...args: any[]) => mockLogin(...args),
    logout: (...args: any[]) => mockLogout(...args),
    requestScopes: (...args: any[]) => mockRequestScopes(...args),
    revokeScopes: (...args: any[]) => mockRevokeScopes(...args),
    getAccessToken: (...args: any[]) => mockGetAccessToken(...args),
    refreshToken: (...args: any[]) => mockRefreshToken(...args),
    onAuthStateChanged: (...args: any[]) => mockOnAuthStateChanged(...args),
    setStorageAdapter: (...args: any[]) => mockSetStorageAdapter(...args),
    onTokensRefreshed: (...args: any[]) => mockOnTokensRefreshed(...args),
  },
}));

// Import after mock
import { useAuth } from "../use-auth";
import { AuthService } from "../service";

describe("useAuth", () => {
  beforeEach(() => {
    mockCurrentUser = undefined;
    mockScopes = [];
    mockLogin.mockReset();
    mockLogout.mockReset();
    mockRequestScopes.mockReset();
    mockRevokeScopes.mockReset();
    mockGetAccessToken.mockReset();
    mockRefreshToken.mockReset();
    mockOnAuthStateChanged.mockReset();
    mockOnAuthStateChanged.mockReturnValue(() => {});
    mockSetStorageAdapter.mockReset();
    mockOnTokensRefreshed.mockReset();
    mockOnTokensRefreshed.mockReturnValue(() => {});
  });

  it("should initialize with no user", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("should initialize with existing user", () => {
    const user: AuthUser = { provider: "google", email: "test@example.com" };
    mockCurrentUser = user;
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toEqual(user);
  });

  it("should expose hasPlayServices", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.hasPlayServices).toBe(true);
  });

  describe("login", () => {
    it("should login successfully", async () => {
      const user: AuthUser = { provider: "google", email: "test@example.com" };
      mockLogin.mockImplementation(async () => {
        mockCurrentUser = user;
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.login("google");
      });

      expect(result.current.loading).toBe(false);
      expect(mockLogin).toHaveBeenCalledWith("google", undefined);
      expect(result.current.user).toEqual(user);
    });

    it("should include serverAuthCode if provided", async () => {
      const user: AuthUser = {
        provider: "google",
        email: "test@example.com",
        serverAuthCode: "xyz123",
      };
      mockLogin.mockImplementation(async () => {
        mockCurrentUser = user;
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.login("google");
      });

      expect(result.current.user?.serverAuthCode).toBe("xyz123");
    });

    it("should login with options", async () => {
      mockLogin.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.login("google", {
          scopes: ["calendar"],
          loginHint: "test@gmail.com",
        });
      });

      expect(mockLogin).toHaveBeenCalledWith("google", {
        scopes: ["calendar"],
        loginHint: "test@gmail.com",
      });
    });

    it("should login with one-tap", async () => {
      mockLogin.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.login("google", { useOneTap: true });
      });

      expect(mockLogin).toHaveBeenCalledWith("google", { useOneTap: true });
    });

    it("sets error when login fails", async () => {
      const error = new Error("network_error");
      // @ts-ignore
      error.underlyingError = "Detailed native error";
      mockLogin.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        try {
          await result.current.login("google");
        } catch (e) {
          // ignore
        }
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error?.message).toBe("network_error");
      expect((result.current.error as any)?.underlyingError).toBe(
        "Detailed native error"
      );
    });

    it("should handle login error", async () => {
      const error = new Error("Login failed");
      mockLogin.mockRejectedValue(error);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        try {
          await result.current.login("google");
        } catch {}
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toEqual(error);
    });

    it("should handle non-Error exceptions", async () => {
      mockLogin.mockRejectedValue("String error");

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        try {
          await result.current.login("google");
        } catch {}
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("String error");
    });
  });

  describe("logout", () => {
    it("should logout successfully", () => {
      mockCurrentUser = { provider: "google", email: "test@example.com" };

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.logout();
      });

      expect(mockLogout).toHaveBeenCalled();
      expect(result.current.user).toBeUndefined();
    });
  });

  describe("requestScopes", () => {
    it("should request scopes successfully", async () => {
      mockRequestScopes.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.requestScopes(["calendar"]);
      });

      expect(mockRequestScopes).toHaveBeenCalledWith(["calendar"]);
      expect(result.current.loading).toBe(false);
    });

    it("should handle requestScopes error", async () => {
      const error = new Error("Scope request failed");
      mockRequestScopes.mockRejectedValue(error);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        try {
          await result.current.requestScopes(["calendar"]);
        } catch {}
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe("revokeScopes", () => {
    it("should revoke scopes successfully", async () => {
      mockRevokeScopes.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.revokeScopes(["calendar"]);
      });

      expect(mockRevokeScopes).toHaveBeenCalledWith(["calendar"]);
    });

    it("should handle revokeScopes error", async () => {
      const error = new Error("Revoke failed");
      mockRevokeScopes.mockRejectedValue(error);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        try {
          await result.current.revokeScopes(["calendar"]);
        } catch {}
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe("getAccessToken", () => {
    it("should get access token", async () => {
      mockGetAccessToken.mockResolvedValue("token123");

      const { result } = renderHook(() => useAuth());

      let token: string | undefined;
      await act(async () => {
        token = await result.current.getAccessToken();
      });

      expect(token).toBe("token123");
    });
  });

  describe("refreshToken", () => {
    it("should refresh token successfully", async () => {
      const tokens = { accessToken: "new_access", idToken: "new_id" };
      mockRefreshToken.mockResolvedValue(tokens);

      const { result } = renderHook(() => useAuth());

      let refreshedTokens: any;
      await act(async () => {
        refreshedTokens = await result.current.refreshToken();
      });

      expect(refreshedTokens).toEqual(tokens);
      expect(result.current.loading).toBe(false);
    });

    it("should handle refreshToken error", async () => {
      const error = new Error("Refresh failed");
      mockRefreshToken.mockRejectedValue(error);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        try {
          await result.current.refreshToken();
        } catch {}
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe("onAuthStateChanged", () => {
    it("should update state when auth state changes", () => {
      let authStateCallback: ((user: AuthUser | undefined) => void) | null =
        null;
      mockOnAuthStateChanged.mockImplementation((callback) => {
        authStateCallback = callback;
        return () => {
          authStateCallback = null;
        };
      });

      const { result } = renderHook(() => useAuth());

      expect(mockOnAuthStateChanged).toHaveBeenCalled();

      const newUser: AuthUser = {
        provider: "google",
        email: "updated@example.com",
      };
      mockCurrentUser = newUser;
      mockScopes = ["email", "profile"];

      act(() => {
        authStateCallback?.(newUser);
      });

      expect(result.current.user).toEqual(newUser);
      expect(result.current.scopes).toEqual(["email", "profile"]);
    });

    it("should unsubscribe on unmount", () => {
      const unsubscribeMock = jest.fn();
      mockOnAuthStateChanged.mockReturnValue(unsubscribeMock);

      const { unmount } = renderHook(() => useAuth());

      unmount();

      expect(unsubscribeMock).toHaveBeenCalled();
    });
  });

  describe("setStorageAdapter", () => {
    it("should set storage adapter", () => {
      const adapter = { save: jest.fn(), load: jest.fn(), remove: jest.fn() };
      const { result } = renderHook(() => useAuth());

      act(() => {
        AuthService.setStorageAdapter(adapter as any);
      });

      expect(mockSetStorageAdapter).toHaveBeenCalledWith(adapter);
    });
  });

  describe("onTokensRefreshed", () => {
    it("should subscribe to token refreshes", () => {
      const callback = jest.fn();
      const unsubscribeMock = jest.fn();
      mockOnTokensRefreshed.mockReturnValue(unsubscribeMock);

      renderHook(() => useAuth());

      const unsubscribe = AuthService.onTokensRefreshed(callback);

      expect(mockOnTokensRefreshed).toHaveBeenCalledWith(callback);

      unsubscribe();
      expect(unsubscribeMock).toHaveBeenCalled();
    });
  });
});

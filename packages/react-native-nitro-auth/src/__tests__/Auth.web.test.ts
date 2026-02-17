const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const MS_REFRESH_TOKEN_KEY = "nitro_auth_microsoft_refresh_token";

type TestAuthUser = {
  provider: string;
  accessToken?: string;
  idToken?: string;
};

type TestAuthModule = {
  currentUser: TestAuthUser | undefined;
  grantedScopes: string[];
  logout: () => void;
  login: (provider: "google") => Promise<void>;
};

const loadAuthModule = async (
  extra?: Record<string, unknown>,
): Promise<TestAuthModule> => {
  jest.resetModules();
  jest.doMock(
    "expo-constants",
    () => ({
      __esModule: true,
      default: { expoConfig: { extra: extra ?? {} } },
    }),
    { virtual: true },
  );
  const module = await import("../Auth.web");
  return module.AuthModule as unknown as TestAuthModule;
};

describe("AuthModule (web)", () => {
  const originalWindowOpen = window.open;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.clearAllMocks();
    jest.useRealTimers();
    if (typeof globalThis.crypto.randomUUID !== "function") {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        writable: true,
        value: () => "test-random-uuid",
      });
    }
  });

  afterEach(() => {
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: originalWindowOpen,
    });
  });

  it("defaults to session storage and strips sensitive tokens from persisted user", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        email: "test@example.com",
        accessToken: "sensitive-access-token",
        idToken: "sensitive-id-token",
      }),
    );
    sessionStorage.setItem(SCOPES_KEY, JSON.stringify(["openid", "email"]));
    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "legacy-refresh-token");

    const auth = await loadAuthModule();

    expect(auth.currentUser?.provider).toBe("google");
    expect(auth.currentUser?.accessToken).toBeUndefined();
    expect(auth.currentUser?.idToken).toBeUndefined();
    expect(auth.grantedScopes).toEqual(["openid", "email"]);
    expect(localStorage.getItem(MS_REFRESH_TOKEN_KEY)).toBeNull();
  });

  it("keeps persisted tokens when explicitly enabled", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        email: "test@example.com",
        accessToken: "persisted-access-token",
        idToken: "persisted-id-token",
      }),
    );
    localStorage.setItem(SCOPES_KEY, JSON.stringify(["openid"]));
    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "persisted-refresh-token");

    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
    });

    expect(auth.currentUser?.accessToken).toBe("persisted-access-token");
    expect(auth.currentUser?.idToken).toBe("persisted-id-token");
    expect(localStorage.getItem(MS_REFRESH_TOKEN_KEY)).toBe(
      "persisted-refresh-token",
    );
  });

  it("clears the Microsoft refresh token on logout", async () => {
    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
    });

    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "refresh-token");
    auth.logout();

    expect(localStorage.getItem(MS_REFRESH_TOKEN_KEY)).toBeNull();
  });

  it("times out popup login instead of polling forever", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "https://accounts.google.com/signin",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn(() => popup),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("timeout"),
      jest.advanceTimersByTimeAsync(120001),
    ]);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });
});

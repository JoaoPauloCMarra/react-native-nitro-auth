const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const MS_REFRESH_TOKEN_KEY = "nitro_auth_microsoft_refresh_token";

type TestAuthUser = {
  provider: string;
  email?: string;
  name?: string;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  expirationTime?: number;
};

type TestAuthModule = {
  currentUser: TestAuthUser | undefined;
  grantedScopes: string[];
  logout: () => void;
  login: (provider: "google" | "apple" | "microsoft") => Promise<void>;
  getAccessToken: () => Promise<string | undefined>;
  refreshToken: () => Promise<{
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    expirationTime?: number;
  }>;
};

const createBase64UrlSegmentFromObject = (value: Record<string, unknown>) => {
  const base64 = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const createPayloadSegmentWithUrlSafeChars = (
  value: Record<string, unknown>,
) => {
  const candidate = {
    ...value,
    // Produces a UTF-8 sequence that yields '/' in base64.
    unicode_marker: String.fromCodePoint(0x00ff),
  };
  const base64 = Buffer.from(JSON.stringify(candidate), "utf8").toString(
    "base64",
  );
  if (!base64.includes("+") && !base64.includes("/")) {
    throw new Error("Unable to generate url-safe payload test segment");
  }

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const createJwtWithUrlSafePayload = (payload: Record<string, unknown>) => {
  const header = createBase64UrlSegmentFromObject({
    alg: "none",
    typ: "JWT",
  });
  const body = createPayloadSegmentWithUrlSafeChars(payload);
  return `${header}.${body}.sig`;
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

  it("deduplicates concurrent token refresh calls", async () => {
    const expSoon = Date.now() + 60_000;
    const refreshedToken = "new-access-token";

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        idToken: "cached-id-token",
        expirationTime: expSoon,
      }),
    );
    localStorage.setItem(SCOPES_KEY, JSON.stringify(["openid"]));
    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "refresh-token");

    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
      microsoftClientId: "test-client-id",
    });

    const fetchMock = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            id_token: "cached-id-token",
            access_token: refreshedToken,
            refresh_token: "refresh-token-2",
            expires_in: 3600,
          }),
        }) as Response,
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    const [tokenA, tokenB] = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    expect(tokenA).toBe(refreshedToken);
    expect(tokenB).toBe(refreshedToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses resolved browser storage without probing on every operation", async () => {
    const probeKey = "__nitro_auth_storage_probe__";
    let probeWrites = 0;
    const originalSetItem = Storage.prototype.setItem;

    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function setItem(
        this: Storage,
        key: string,
        value: string,
      ) {
        if (key === probeKey) {
          probeWrites += 1;
        }
        originalSetItem.call(this, key, value);
      });

    const auth = await loadAuthModule();
    const baselineProbeWrites = probeWrites;

    auth.logout();
    auth.logout();

    expect(probeWrites - baselineProbeWrites).toBeLessThanOrEqual(1);
    setItemSpy.mockRestore();
  });

  it("loads Apple SDK script only once across multiple logins", async () => {
    const signInMock = jest.fn(async () => ({
      authorization: { id_token: "apple-id-token" },
      user: { email: "apple@example.com" },
    }));
    const initMock = jest.fn();

    Object.defineProperty(window, "AppleID", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const appendSpy = jest
      .spyOn(document.head, "appendChild")
      .mockImplementation((node: Node) => {
        const scriptNode = node as HTMLScriptElement;
        setTimeout(() => {
          Object.defineProperty(window, "AppleID", {
            configurable: true,
            writable: true,
            value: {
              auth: {
                init: initMock,
                signIn: signInMock,
              },
            },
          });
          scriptNode.onload?.(new Event("load"));
        }, 0);
        return node;
      });

    const auth = await loadAuthModule({
      appleWebClientId: "apple-client-id",
    });

    await auth.login("apple");
    await auth.login("apple");

    expect(signInMock).toHaveBeenCalledTimes(2);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    appendSpy.mockRestore();
  });

  it("decodes url-safe JWT payloads during Microsoft refresh", async () => {
    const email = "claims@example.com";
    const idToken = createJwtWithUrlSafePayload({
      preferred_username: email,
      name: "Claims User",
    });

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        expirationTime: Date.now() + 60_000,
      }),
    );
    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "refresh-token");

    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
      microsoftClientId: "test-client-id",
    });

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              id_token: idToken,
              access_token: "new-access",
              refresh_token: "new-refresh",
              expires_in: 3600,
            }),
          }) as Response,
      ),
    });

    await auth.refreshToken();

    expect(auth.currentUser?.email).toBe(email);
  });
});

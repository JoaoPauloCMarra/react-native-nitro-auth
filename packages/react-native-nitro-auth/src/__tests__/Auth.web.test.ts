import { TextDecoder, TextEncoder } from "util";

const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const MS_REFRESH_TOKEN_KEY = "nitro_auth_microsoft_refresh_token";

type TestAuthUser = {
  provider: string;
  email?: string;
  name?: string;
  photo?: string;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  expirationTime?: number;
  userId?: string;
  scopes?: string[];
};

type TestAuthEvent = {
  type: string;
  provider?: string;
  errorCode?: string;
};

type TestAuthModule = {
  currentUser: TestAuthUser | undefined;
  grantedScopes: string[];
  logout: () => void;
  login: (
    provider: "google" | "apple" | "microsoft",
    options?: Record<string, unknown>,
  ) => Promise<void>;
  onAuthStateChanged: (
    callback: (user: TestAuthUser | undefined) => void,
  ) => () => void;
  onTokensRefreshed: (
    callback: (tokens: {
      accessToken?: string;
      idToken?: string;
      refreshToken?: string;
      expirationTime?: number;
    }) => void,
  ) => () => void;
  onAuthEvent: (callback: (event: TestAuthEvent) => void) => () => void;
  getAccessToken: () => Promise<string | undefined>;
  requestScopes: (scopes: string[]) => Promise<void>;
  revokeAccess: () => Promise<void>;
  revokeScopes: (scopes: string[]) => Promise<{
    revokedAtProvider: false;
    revokedScopes: string[];
  }>;
  refreshToken: () => Promise<{
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    expirationTime?: number;
  }>;
  silentRestore: () => Promise<void>;
  dispose: () => void;
  setWebStorageAdapter: (
    adapter:
      | {
          save: (key: string, value: string) => void | Promise<void>;
          load: (
            key: string,
          ) => string | undefined | Promise<string | undefined>;
          remove: (key: string) => void | Promise<void>;
        }
      | undefined,
  ) => void;
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

const createJwtWithPayload = (payload: Record<string, unknown>) => {
  const header = createBase64UrlSegmentFromObject({
    alg: "none",
    typ: "JWT",
  });
  const body = createBase64UrlSegmentFromObject(payload);
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

const loadAuthService = async (extra?: Record<string, unknown>) => {
  jest.resetModules();
  jest.doMock(
    "expo-constants",
    () => ({
      __esModule: true,
      default: { expoConfig: { extra: extra ?? {} } },
    }),
    { virtual: true },
  );
  const module = await import("../service.web");
  return module.AuthService;
};

describe("AuthModule (web)", () => {
  const originalWindowOpen = window.open;
  const originalFetch = globalThis.fetch;

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
    if (typeof globalThis.TextEncoder !== "function") {
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: TextEncoder,
      });
    }
    if (typeof globalThis.TextDecoder !== "function") {
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: TextDecoder,
      });
    }
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: {
        digest: jest.fn<
          Promise<ArrayBuffer>,
          [AlgorithmIdentifier, BufferSource]
        >(async () => new ArrayBuffer(32)),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: originalWindowOpen,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
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

  it("revokes Google access before clearing the local session", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        accessToken: "google-access-token",
      }),
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async () => ({ ok: true }) as Response),
    });
    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
    });

    await auth.revokeAccess();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "token=google-access-token",
      },
    );
    expect(auth.currentUser).toBeUndefined();
  });

  it("keeps the session when Google access revocation fails", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        accessToken: "google-access-token",
      }),
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async () => {
        throw new Error("network unavailable");
      }),
    });
    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
    });

    await expect(auth.revokeAccess()).rejects.toThrow("network_error");
    expect(auth.currentUser?.provider).toBe("google");
  });

  it("rejects providers without a client-side revocation API", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        accessToken: "microsoft-access-token",
      }),
    );
    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
    });

    await expect(auth.revokeAccess()).rejects.toThrow("unsupported_provider");
    expect(auth.currentUser?.provider).toBe("microsoft");
  });

  it("suppresses only a missing session during silent restore", async () => {
    const auth = await loadAuthModule();

    await expect(auth.silentRestore()).resolves.toBeUndefined();
  });

  it("recreates the web auth singleton after disposal", async () => {
    const auth = await loadAuthService();

    auth.dispose();

    await expect(auth.login("google")).rejects.toMatchObject({
      code: "configuration_error",
    });
  });

  it("propagates configuration failures during silent restore", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        expirationTime: Date.now() - 1,
      }),
    );
    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "refresh-token");
    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
    });

    await expect(auth.silentRestore()).rejects.toThrow("configuration_error");
    expect(auth.currentUser?.provider).toBe("microsoft");
  });

  it("propagates network failures during silent restore", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        expirationTime: Date.now() - 1,
      }),
    );
    localStorage.setItem(MS_REFRESH_TOKEN_KEY, "refresh-token");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async () => {
        throw new Error("network unavailable");
      }),
    });
    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistTokensOnWeb: true,
      microsoftClientId: "test-client-id",
    });

    await expect(auth.silentRestore()).rejects.toThrow("network_error");
    expect(auth.currentUser?.provider).toBe("microsoft");
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

  it("maps concurrent login attempts to operation_in_progress", async () => {
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

    const firstLogin = auth.login("google");
    await expect(auth.login("google")).rejects.toThrow("operation_in_progress");
    await Promise.all([
      expect(firstLogin).rejects.toThrow("timeout"),
      jest.advanceTimersByTimeAsync(120001),
    ]);
  });

  it("normalizes Google OAuth denial to cancelled", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#error=access_denied&error_description=user%20closed&state=${state}`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("cancelled"),
      jest.advanceTimersByTimeAsync(501),
    ]);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("normalizes missing Google id tokens to no_id_token", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#access_token=access-token&state=${state}`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("no_id_token"),
      jest.advanceTimersByTimeAsync(501),
    ]);
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

  it("keeps token listener notifications stable while listeners unsubscribe", async () => {
    const expSoon = Date.now() + 60_000;

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        idToken: "cached-id-token",
        expirationTime: expSoon,
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
              id_token: "cached-id-token",
              access_token: "new-access-token",
              expires_in: 3600,
            }),
          }) as Response,
      ),
    });

    let unsubscribeB: () => void = () => undefined;
    const listenerA = jest.fn(() => {
      unsubscribeB();
    });
    const listenerB = jest.fn();

    auth.onTokensRefreshed(listenerA);
    unsubscribeB = auth.onTokensRefreshed(listenerB);

    await auth.refreshToken();

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
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
    const idToken = createJwtWithPayload({
      nonce: "test-random-uuid",
      email: "apple@example.com",
    });
    const signInMock = jest.fn(async () => ({
      authorization: { id_token: idToken },
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

  it("ignores invalid expires_in values during Microsoft refresh", async () => {
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
              id_token: createJwtWithPayload({
                nonce: "test-random-uuid",
              }),
              access_token: "new-access",
              expires_in: "not-a-number",
            }),
          }) as Response,
      ),
    });

    const tokens = await auth.refreshToken();

    expect(tokens.expirationTime).toBeUndefined();
    expect(auth.currentUser?.expirationTime).toBeUndefined();
  });

  it("normalizes Microsoft state mismatches to invalid_state", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        popup.location.href = `${window.location.origin}?code=auth-code&state=wrong-state`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    const loginPromise = auth.login("microsoft");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("invalid_state"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("rejects absolute Microsoft tenant URLs", async () => {
    const open = jest.fn();
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
      microsoftTenant: "https://login.evil.test/common",
    });

    await expect(auth.login("microsoft")).rejects.toThrow(
      "configuration_error",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects invalid Microsoft B2C domains", async () => {
    const open = jest.fn();
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
      microsoftTenant: "B2C_1_signin",
      microsoftB2cDomain: "contoso.b2clogin.com/path",
    });

    await expect(auth.login("microsoft")).rejects.toThrow(
      "configuration_error",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("derives Microsoft B2C tenant paths from b2clogin policy values", async () => {
    const open = jest.fn<
      ReturnType<typeof window.open>,
      Parameters<typeof window.open>
    >(() => null);
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
      microsoftTenant: "B2C_1_signin",
      microsoftB2cDomain: "contoso.b2clogin.com",
    });

    await expect(auth.login("microsoft")).rejects.toThrow("popup_blocked");
    expect(open).toHaveBeenCalledTimes(1);
    const [authUrl] = open.mock.calls[0] ?? [];
    if (authUrl === undefined) {
      throw new Error("Expected Microsoft auth URL");
    }
    const url = new URL(authUrl);
    expect(url.origin).toBe("https://contoso.b2clogin.com");
    expect(url.pathname).toBe(
      "/contoso.onmicrosoft.com/B2C_1_signin/oauth2/v2.0/authorize",
    );
  });

  it("allows Microsoft B2C tenant policy paths", async () => {
    const open = jest.fn<
      ReturnType<typeof window.open>,
      Parameters<typeof window.open>
    >(() => null);
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
      microsoftTenant: "contoso.onmicrosoft.com/B2C_1_signin",
      microsoftB2cDomain: "contoso.b2clogin.com",
    });

    await expect(auth.login("microsoft")).rejects.toThrow("popup_blocked");
    expect(open).toHaveBeenCalledTimes(1);
    const [authUrl] = open.mock.calls[0] ?? [];
    if (authUrl === undefined) {
      throw new Error("Expected Microsoft auth URL");
    }
    const url = new URL(authUrl);
    expect(url.origin).toBe("https://contoso.b2clogin.com");
    expect(url.pathname).toBe(
      "/contoso.onmicrosoft.com/B2C_1_signin/oauth2/v2.0/authorize",
    );
  });

  it("rejects policy-only Microsoft B2C tenants on custom domains", async () => {
    const open = jest.fn();
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
      microsoftTenant: "B2C_1_signin",
      microsoftB2cDomain: "login.contoso.com",
    });

    await expect(auth.login("microsoft")).rejects.toThrow(
      "configuration_error",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("normalizes Microsoft token responses without id tokens to no_id_token", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}?code=auth-code&state=${state}`;
        return popup;
      }),
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              access_token: "access-token",
            }),
          }) as Response,
      ),
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    const loginPromise = auth.login("microsoft");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("no_id_token"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("normalizes Microsoft nonce mismatches to invalid_nonce", async () => {
    jest.useFakeTimers();
    const idToken = createJwtWithPayload({
      nonce: "different-nonce",
    });
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}?code=auth-code&state=${state}`;
        return popup;
      }),
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
              access_token: "access-token",
            }),
          }) as Response,
      ),
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    const loginPromise = auth.login("microsoft");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("invalid_nonce"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("rejects Google redirects with a missing state", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        popup.location.href = `${window.location.origin}#id_token=some-token`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("invalid_state"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("rejects Google redirects with a forged state", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        popup.location.href = `${window.location.origin}#id_token=some-token&state=forged-state`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("invalid_state"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("rejects popup redirects that are not the exact registered target", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        // A different path on the same origin must not be parsed.
        popup.location.href = `${window.location.origin}/signin/callback#id_token=some-token&state=${state}`;
        return popup;
      }),
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

  it("never opens a popup when a Google token is near expiry during silent restore", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        idToken: "cached-id-token",
        accessToken: "cached-access-token",
        expirationTime: Date.now() + 60_000,
      }),
    );
    sessionStorage.setItem(SCOPES_KEY, JSON.stringify(["openid"]));
    const open = jest.fn();
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    await expect(auth.silentRestore()).rejects.toThrow("interaction_required");
    expect(open).not.toHaveBeenCalled();
    // Tokens are memory-only by default, so the cached token stays stripped.
    expect(auth.currentUser?.accessToken).toBeUndefined();
    expect(auth.currentUser?.provider).toBe("google");
  });

  it("restores a fresh Google session without opening a popup", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        accessToken: "fresh-token",
        expirationTime: Date.now() + 3600_000,
      }),
    );
    const open = jest.fn();
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule();

    await expect(auth.silentRestore()).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps tokens memory-only with a custom storage adapter unless opt-in", async () => {
    const adapterStorage = new Map<string, string>();
    const adapter = {
      save: (key: string, value: string) => {
        adapterStorage.set(key, value);
      },
      load: (key: string) => adapterStorage.get(key),
      remove: (key: string) => {
        adapterStorage.delete(key);
      },
    };

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        accessToken: "sensitive-token",
        refreshToken: "sensitive-refresh",
        idToken: "sensitive-id",
      }),
    );

    const auth = await loadAuthModule();
    auth.setWebStorageAdapter(adapter);

    expect(auth.currentUser?.accessToken).toBeUndefined();
    expect(auth.currentUser?.refreshToken).toBeUndefined();
    expect(auth.currentUser?.idToken).toBeUndefined();
  });

  it("strips profile PII from persisted users when disabled", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        email: "pii@example.com",
        name: "PII Name",
        photo: "https://example.com/photo.jpg",
        userId: "sub-123",
      }),
    );

    const auth = await loadAuthModule({
      nitroAuthWebStorage: "local",
      nitroAuthPersistProfileOnWeb: false,
    });
    expect(auth.currentUser?.email).toBeUndefined();
    expect(auth.currentUser?.name).toBeUndefined();
    expect(auth.currentUser?.photo).toBeUndefined();
    expect(auth.currentUser?.userId).toBe("sub-123");
  });

  it("revokeScopes returns a typed local-only result", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        scopes: ["email", "profile"],
      }),
    );
    sessionStorage.setItem(SCOPES_KEY, JSON.stringify(["email", "profile"]));
    const auth = await loadAuthModule();

    const result = await auth.revokeScopes(["email", "missing"]);

    expect(result).toEqual({
      revokedAtProvider: false,
      revokedScopes: ["email"],
    });
    expect(auth.grantedScopes).toEqual(["profile"]);
    expect(auth.currentUser?.scopes).toEqual(["profile"]);
  });

  it("emits typed auth events across login and logout", async () => {
    const events: string[] = [];
    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });
    auth.onAuthEvent((event) => {
      events.push(
        `${event.type}:${event.provider ?? ""}:${event.errorCode ?? ""}`,
      );
    });

    jest.useFakeTimers();
    const idToken = createJwtWithPayload({
      nonce: "test-random-uuid",
    });
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#id_token=${idToken}&state=${state}&expires_in=3600`;
        return popup;
      }),
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).resolves.toBeUndefined(),
      jest.advanceTimersByTimeAsync(501),
    ]);

    auth.logout();

    expect(events).toContain("login_started:google:");
    expect(events).toContain("login_succeeded:google:");
    expect(events).toContain("session_changed:google:");
    expect(events).toContain("logout:google:");
  });

  it("emits login_failed with the typed error code", async () => {
    const events: string[] = [];
    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });
    auth.onAuthEvent((event) => {
      events.push(`${event.type}:${event.errorCode ?? ""}`);
    });

    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#error=access_denied&state=${state}`;
        return popup;
      }),
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("cancelled"),
      jest.advanceTimersByTimeAsync(501),
    ]);

    expect(events).toContain("login_failed:cancelled");
  });

  it("emits dispose to registered event listeners", async () => {
    const events: string[] = [];
    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });
    auth.onAuthEvent((event) => {
      events.push(event.type);
    });

    auth.dispose();

    expect(events).toContain("dispose");
  });

  it("logout settles an in-flight refresh with not_signed_in", async () => {
    const expSoon = Date.now() + 60_000;
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        idToken: "cached-id-token",
        expirationTime: expSoon,
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
      value: jest.fn(() => new Promise<Response>(() => {})),
    });

    const refreshPromise = auth.refreshToken();
    auth.logout();

    await expect(refreshPromise).rejects.toThrow("not_signed_in");
  });

  it("dispose rejects a pending login with cancelled", async () => {
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
    auth.dispose();

    await expect(loginPromise).rejects.toThrow("cancelled");
  });

  it("maps Microsoft refresh grant failures to refresh_failed", async () => {
    const expSoon = Date.now() + 60_000;
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        idToken: "cached-id-token",
        expirationTime: expSoon,
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
            ok: false,
            json: async () => ({
              error: "invalid_grant",
              error_description: "The grant is expired",
            }),
          }) as Response,
      ),
    });

    await expect(auth.refreshToken()).rejects.toThrow("refresh_failed");
  });

  it("rejects Apple identity tokens with a mismatched nonce", async () => {
    const signInMock = jest.fn(async () => ({
      authorization: {
        id_token: createJwtWithPayload({ nonce: "different-nonce" }),
      },
    }));
    const initMock = jest.fn();

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

    const auth = await loadAuthModule({
      appleWebClientId: "apple-client-id",
    });

    await expect(
      auth.login("apple", { nonce: "expected-nonce" }),
    ).rejects.toThrow("invalid_nonce");
  });

  it("falls back to in-memory storage when browser storage throws", async () => {
    const originalSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const auth = await loadAuthModule();
    auth.logout();
    auth.logout();

    expect(auth.currentUser).toBeUndefined();
    jest.restoreAllMocks();
    Storage.prototype.setItem = originalSetItem;
  });

  it("clears corrupted cached users and scope lists", async () => {
    sessionStorage.setItem(CACHE_KEY, "not-json");
    sessionStorage.setItem(SCOPES_KEY, "also-not-json");

    const auth = await loadAuthModule();

    expect(auth.currentUser).toBeUndefined();
    expect(auth.grantedScopes).toEqual([]);
    expect(sessionStorage.getItem(CACHE_KEY)).toBeNull();
    expect(sessionStorage.getItem(SCOPES_KEY)).toBeNull();
  });

  it("falls back to defaults when expo-constants throws", async () => {
    jest.resetModules();
    jest.doMock(
      "expo-constants",
      () => ({
        __esModule: true,
        get default() {
          throw new Error("expo-constants broken");
        },
      }),
      { virtual: true },
    );
    const module = await import("../Auth.web");
    const auth = module.AuthModule as unknown as TestAuthModule;

    expect(auth.currentUser).toBeUndefined();
    await expect(auth.login("microsoft")).rejects.toThrow(
      "configuration_error",
    );
  });

  it("rejects synchronous storage adapters that return promises", async () => {
    const auth = await loadAuthModule();
    // An async load fails at adapter install time (loadFromCache).
    expect(() => {
      auth.setWebStorageAdapter({
        save: () => {},
        load: () => Promise.resolve("x"),
        remove: () => {},
      });
    }).toThrow("must be synchronous");

    const auth2 = await loadAuthModule();
    auth2.setWebStorageAdapter({
      save: () => Promise.resolve(),
      load: () => undefined,
      remove: () => {},
    });
    // An async save fails on the first persistence write.
    await expect(auth2.revokeScopes(["email"])).rejects.toThrow(
      "must be synchronous",
    );
  });

  it("persists tokens through a custom adapter when explicitly enabled", async () => {
    const adapterStorage = new Map<string, string>();
    const adapter = {
      save: (key: string, value: string) => {
        adapterStorage.set(key, value);
      },
      load: (key: string) => adapterStorage.get(key),
      remove: (key: string) => {
        adapterStorage.delete(key);
      },
    };

    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        accessToken: "adapter-token",
        expirationTime: Date.now() + 3600_000,
      }),
    );

    const auth = await loadAuthModule({
      nitroAuthPersistTokensOnWeb: true,
    });
    auth.setWebStorageAdapter(adapter);

    expect(auth.currentUser?.accessToken).toBe("adapter-token");
    expect(auth.currentUser?.expirationTime).toBeGreaterThan(Date.now());
  });

  it("login after dispose rejects with cancelled", async () => {
    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });
    auth.dispose();

    await expect(auth.login("google")).rejects.toThrow("cancelled");
  });

  it("requestScopes requires a signed-in user", async () => {
    const auth = await loadAuthModule();
    await expect(auth.requestScopes(["email"])).rejects.toThrow(
      "not_signed_in",
    );
  });

  it("requestScopes rejects for Apple sessions", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ provider: "apple", idToken: "apple-id" }),
    );
    const auth = await loadAuthModule();
    await expect(auth.requestScopes(["email"])).rejects.toThrow(
      "unsupported_provider",
    );
  });

  it("revokeAccess requires a signed-in user and a token", async () => {
    const noUser = await loadAuthModule();
    await expect(noUser.revokeAccess()).rejects.toThrow("not_signed_in");

    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ provider: "google" }));
    const noToken = await loadAuthModule();
    await expect(noToken.revokeAccess()).rejects.toThrow("token_error");
  });

  it("google login without a client id fails with configuration_error", async () => {
    const auth = await loadAuthModule();
    await expect(auth.login("google")).rejects.toThrow("configuration_error");
  });

  it("microsoft login without a client id fails with configuration_error", async () => {
    const auth = await loadAuthModule();
    await expect(auth.login("microsoft")).rejects.toThrow(
      "configuration_error",
    );
  });

  it("maps message-based failures through the fallback table", async () => {
    const messages: [string, string][] = [
      ["user cancelled the flow", "cancelled"],
      ["popup_closed_by_user", "cancelled"],
      ["access_denied", "cancelled"],
      ["google_auth_timeout", "timeout"],
      ["no user logged in", "not_signed_in"],
      ["invalid_grant", "refresh_failed"],
      ["network is down", "network_error"],
      ["state mismatch", "invalid_state"],
      ["nonce mismatch", "invalid_nonce"],
      ["no id_token returned", "no_id_token"],
      ["invalid JSON payload", "parse_error"],
      ["invalid_scope requested", "configuration_error"],
      ["unexpected vendor failure", "unknown"],
    ];
    for (const [message, expectedCode] of messages) {
      Object.defineProperty(window, "AppleID", {
        configurable: true,
        writable: true,
        value: {
          auth: {
            init: jest.fn(),
            signIn: jest.fn(async () => {
              throw new Error(message);
            }),
          },
        },
      });
      const auth = await loadAuthModule({
        appleWebClientId: "apple-client-id",
      });
      const error = await auth.login("apple").then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(String((error as Error)?.message)).toBe(expectedCode);
    }
  });

  it("times out popup logins when the popup origin cannot be read", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
    } as unknown as Window;
    Object.defineProperty(popup, "location", {
      configurable: true,
      get() {
        throw new Error("cross-origin");
      },
    });
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
  });

  it("rejects malformed Google id tokens with parse_error", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#id_token=not-a-jwt&state=${state}`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("parse_error"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("maps token exchange grant failures to token_error", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}?code=auth-code&state=${state}`;
        return popup;
      }),
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(
        async () =>
          ({
            ok: false,
            json: async () => ({
              error: "invalid_grant",
              error_description: "The grant is expired",
            }),
          }) as Response,
      ),
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    const loginPromise = auth.login("microsoft");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("token_error"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("silent restore with a Microsoft session but no refresh token resolves", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        expirationTime: Date.now() + 60_000,
      }),
    );
    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    await expect(auth.silentRestore()).resolves.toBeUndefined();
    expect(auth.currentUser?.provider).toBe("microsoft");
  });

  it("rejects when the Apple SDK script fails to load", async () => {
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
          scriptNode.onerror?.(new Event("error"));
        }, 0);
        return node;
      });

    const auth = await loadAuthModule({
      appleWebClientId: "apple-client-id",
    });

    await expect(auth.login("apple")).rejects.toThrow("unknown");
    appendSpy.mockRestore();
  });

  it("keeps the session when Google revocation returns an HTTP failure", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        accessToken: "google-access-token",
      }),
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async () => ({ ok: false, status: 400 }) as Response),
    });
    const auth = await loadAuthModule();

    await expect(auth.revokeAccess()).rejects.toThrow("token_error");
    expect(auth.currentUser?.provider).toBe("google");
  });

  it("requests additional Google scopes through the popup flow", async () => {
    jest.useFakeTimers();
    const idToken = createJwtWithPayload({
      nonce: "test-random-uuid",
    });
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#id_token=${idToken}&state=${state}&expires_in=3600`;
        return popup;
      }),
    });

    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "google",
        idToken: "cached-id",
      }),
    );
    sessionStorage.setItem(SCOPES_KEY, JSON.stringify(["email"]));
    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const scopesPromise = auth.requestScopes(["profile"]);
    await Promise.all([
      expect(scopesPromise).resolves.toBeUndefined(),
      jest.advanceTimersByTimeAsync(501),
    ]);
    expect(auth.grantedScopes).toEqual(
      expect.arrayContaining(["email", "profile"]),
    );
  });

  it("maps remaining fallback-table branches", async () => {
    const cases: [string, string][] = [
      ["login is already in progress", "operation_in_progress"],
      ["the user is not signed in", "not_signed_in"],
      ["popup blocked by the browser", "popup_blocked"],
      ["invalid_client rejected", "configuration_error"],
      ["invalid_token rejected", "refresh_failed"],
      ["temporarily_unavailable", "network_error"],
      ["server_error", "network_error"],
      ["unauthorized_client", "configuration_error"],
    ];
    for (const [message, expectedCode] of cases) {
      Object.defineProperty(window, "AppleID", {
        configurable: true,
        writable: true,
        value: {
          auth: {
            init: jest.fn(),
            signIn: jest.fn(async () => {
              throw new Error(message);
            }),
          },
        },
      });
      const auth = await loadAuthModule({
        appleWebClientId: "apple-client-id",
      });
      const error = await auth.login("apple").then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(String((error as Error)?.message)).toBe(expectedCode);
    }
  });

  it("maps refresh failures without a session to not_signed_in", async () => {
    const auth = await loadAuthModule();
    await expect(auth.refreshToken()).rejects.toThrow("not_signed_in");
  });

  it("requests Apple login with explicit scopes", async () => {
    const initMock = jest.fn();
    const signInMock = jest.fn(async () => ({
      authorization: {
        id_token: createJwtWithPayload({ nonce: "test-random-uuid" }),
      },
    }));
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

    const auth = await loadAuthModule({
      appleWebClientId: "apple-client-id",
    });

    await expect(
      auth.login("apple", { scopes: ["name"] }),
    ).resolves.toBeUndefined();
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "name" }),
    );
  });

  it("isolates throwing auth-state listeners", async () => {
    const auth = await loadAuthModule();
    const throwing = jest.fn(() => {
      throw new Error("listener failed");
    });
    const healthy = jest.fn();
    auth.onAuthStateChanged(throwing);
    auth.onAuthStateChanged(healthy);

    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ provider: "google" }));
    const auth2 = await loadAuthModule();
    void auth2;
    auth.logout();

    expect(healthy).toHaveBeenCalled();
  });

  it("rejects non-JSON token endpoint responses with parse_error", async () => {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        expirationTime: Date.now() + 60_000,
      }),
    );
    sessionStorage.setItem(MS_REFRESH_TOKEN_KEY, "refresh-token");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(
        async () =>
          ({
            ok: true,
            json: async () => {
              throw new Error("Unexpected token < in JSON");
            },
          }) as unknown as Response,
      ),
    });

    const auth = await loadAuthModule({
      nitroAuthPersistTokensOnWeb: true,
      microsoftClientId: "test-client-id",
    });

    await expect(auth.refreshToken()).rejects.toThrow("parse_error");
  });

  it("passes forceAccountPicker and openIDRealm into the Google auth URL", async () => {
    const open = jest.fn(() => null);
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    await expect(
      auth.login("google", {
        forceAccountPicker: true,
        openIDRealm: "https://example.com",
        hostedDomain: "example.com",
      }),
    ).rejects.toThrow("popup_blocked");
    const firstCall: unknown[] = open.mock.calls[0] ?? [];
    const url = new URL(String(firstCall[0]));
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("openid.realm")).toBe("https://example.com");
    expect(url.searchParams.get("hd")).toBe("example.com");
  });

  it("passes loginHint and prompt into the Microsoft auth URL", async () => {
    const open = jest.fn(() => null);
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: open,
    });

    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    await expect(
      auth.login("microsoft", {
        loginHint: "user@example.com",
        prompt: "consent",
      }),
    ).rejects.toThrow("popup_blocked");
    const firstCall: unknown[] = open.mock.calls[0] ?? [];
    const url = new URL(String(firstCall[0]));
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("removes the storage adapter when cleared", async () => {
    const adapter = {
      save: () => {},
      load: () => undefined,
      remove: () => {},
    };
    const auth = await loadAuthModule();
    auth.setWebStorageAdapter(adapter);
    auth.setWebStorageAdapter(undefined);

    expect(auth.currentUser).toBeUndefined();
    expect(auth.grantedScopes).toEqual([]);
  });

  it("rejects Google redirects with malformed JWT payloads", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#id_token=eyJhbGciOiJub25lIn0.bm90LXZhbGlkLWJhc2U2NC1jaGFycw&state=${state}`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("parse_error"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("tolerates storage removal failures during logout", async () => {
    const originalRemoveItem = Storage.prototype.removeItem;
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ provider: "google" }));

    const auth = await loadAuthModule();
    auth.logout();

    expect(auth.currentUser).toBeUndefined();
    jest.restoreAllMocks();
    Storage.prototype.removeItem = originalRemoveItem;
  });

  it("rejects unknown providers with unsupported_provider", async () => {
    const auth = await loadAuthModule();
    await expect(auth.login("unknown" as never)).rejects.toThrow(
      "unsupported_provider",
    );
  });

  it("joins Apple full names on first authorization", async () => {
    const signInMock = jest.fn(async () => ({
      authorization: {
        id_token: createJwtWithPayload({ nonce: "test-random-uuid" }),
      },
      user: {
        email: "apple@example.com",
        name: { firstName: "Jane", lastName: "Doe" },
      },
    }));
    Object.defineProperty(window, "AppleID", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          init: jest.fn(),
          signIn: signInMock,
        },
      },
    });

    const auth = await loadAuthModule({
      appleWebClientId: "apple-client-id",
    });

    await auth.login("apple");
    expect(auth.currentUser?.name).toBe("Jane Doe");
  });

  it("resetAuthModule ignores foreign instances", async () => {
    jest.resetModules();
    jest.doMock(
      "expo-constants",
      () => ({
        __esModule: true,
        default: { expoConfig: { extra: {} } },
      }),
      { virtual: true },
    );
    const module = await import("../Auth.web");
    const original = module.AuthModule;
    const foreign = {} as never;
    module.resetAuthModule(foreign);
    expect(module.AuthModule).toBe(original);
  });

  it("requests additional Microsoft scopes through the popup flow", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}?code=auth-code&state=${state}`;
        return popup;
      }),
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              id_token: createJwtWithPayload({ nonce: "test-random-uuid" }),
              access_token: "fresh",
              refresh_token: "refresh",
              expires_in: 3600,
            }),
          }) as unknown as Response,
      ),
    });

    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        provider: "microsoft",
        idToken: "cached-id",
      }),
    );
    sessionStorage.setItem(SCOPES_KEY, JSON.stringify(["openid"]));
    const auth = await loadAuthModule({
      microsoftClientId: "test-client-id",
    });

    const scopesPromise = auth.requestScopes(["User.Read"]);
    await Promise.all([
      expect(scopesPromise).resolves.toBeUndefined(),
      jest.advanceTimersByTimeAsync(501),
    ]);
    expect(auth.grantedScopes).toEqual(
      expect.arrayContaining(["openid", "User.Read"]),
    );
  });

  it("rejects Google redirects whose JWT payload contains invalid characters", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: "",
      },
    } as unknown as Window;
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: jest.fn((url: string) => {
        const state = new URL(url).searchParams.get("state");
        popup.location.href = `${window.location.origin}#id_token=eyJhbGciOiJub25lIn0.bad!!chars&state=${state}`;
        return popup;
      }),
    });

    const auth = await loadAuthModule({
      googleWebClientId: "test-client-id.apps.googleusercontent.com",
    });

    const loginPromise = auth.login("google");
    await Promise.all([
      expect(loginPromise).rejects.toThrow("parse_error"),
      jest.advanceTimersByTimeAsync(501),
    ]);
  });

  it("reuses an existing Apple SDK script element", async () => {
    const existingScript = document.createElement("script");
    existingScript.id = "nitro-auth-apple-sdk";
    document.head.appendChild(existingScript);
    const appendSpy = jest.spyOn(document.head, "appendChild");

    Object.defineProperty(window, "AppleID", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(window, "AppleID", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          init: jest.fn(),
          signIn: jest.fn(async () => ({
            authorization: {
              id_token: createJwtWithPayload({
                nonce: "test-random-uuid",
              }),
            },
          })),
        },
      },
    });
    // The script element already exists and the SDK is present: no new
    // element is appended and login proceeds synchronously.
    const auth = await loadAuthModule({
      appleWebClientId: "apple-client-id",
    });

    await expect(auth.login("apple")).resolves.toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();
    appendSpy.mockRestore();
    existingScript.remove();
  });
});

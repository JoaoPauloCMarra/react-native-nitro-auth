import { TextDecoder, TextEncoder } from "util";

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
        href: `${window.location.origin}#error=access_denied&error_description=user%20closed`,
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
      expect(loginPromise).rejects.toThrow("cancelled"),
      jest.advanceTimersByTimeAsync(101),
    ]);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("normalizes missing Google id tokens to no_id_token", async () => {
    jest.useFakeTimers();
    const popup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: `${window.location.origin}#access_token=access-token`,
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
      expect(loginPromise).rejects.toThrow("no_id_token"),
      jest.advanceTimersByTimeAsync(101),
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
      jest.advanceTimersByTimeAsync(101),
    ]);
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
      jest.advanceTimersByTimeAsync(101),
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
      jest.advanceTimersByTimeAsync(101),
    ]);
  });
});

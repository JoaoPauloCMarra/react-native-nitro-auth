import { AuthWebError, getSafeErrorCategory } from "../utils/auth-web-error";
import { WebSessionStorage } from "../utils/web-session-storage";

const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const REFRESH_KEY = "nitro_auth_microsoft_refresh_token";

const fullUser = {
  provider: "google",
  email: "user@example.com",
  name: "User",
  idToken: "id-token",
  accessToken: "access-token",
  serverAuthCode: "server-code",
};

describe("WebSessionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    new WebSessionStorage({}).clearRefreshToken();
  });

  describe("cache restore", () => {
    it.each([
      ["non-JSON text", "not-json"],
      ["a JSON scalar", "42"],
      ["an unknown provider", JSON.stringify({ provider: "github" })],
      ["a missing provider", JSON.stringify({ email: "a@b.c" })],
    ])("drops %s and removes the entry", (_label, cached) => {
      sessionStorage.setItem(CACHE_KEY, cached);

      expect(new WebSessionStorage({}).restore()).toEqual({});

      expect(sessionStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it("keeps a bad cache entry when removing it fails", () => {
      sessionStorage.setItem(CACHE_KEY, "not-json");
      jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("storage unavailable");
      });

      expect(() => new WebSessionStorage({}).restore()).not.toThrow();
    });

    it("strips credentials and rewrites the cache unless tokens persist", () => {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(fullUser));

      const restored = new WebSessionStorage({}).restore();

      expect(restored.user).toEqual({
        provider: "google",
        email: "user@example.com",
        name: "User",
      });
      expect(JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "{}")).toEqual({
        provider: "google",
        email: "user@example.com",
        name: "User",
      });
    });

    it("keeps credentials when token persistence is enabled", () => {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(fullUser));

      const restored = new WebSessionStorage({
        nitroAuthPersistTokensOnWeb: true,
      }).restore();

      expect(restored.user?.accessToken).toBe("access-token");
    });

    it("drops profile fields when profile persistence is disabled", () => {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(fullUser));

      const restored = new WebSessionStorage({
        nitroAuthPersistProfileOnWeb: false,
      }).restore();

      expect(restored.user).toEqual({ provider: "google" });
    });

    it("still returns the sanitized user when rewriting the cache fails", () => {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(fullUser));
      const probe = jest.spyOn(Storage.prototype, "setItem");
      probe.mockImplementation((key: string) => {
        if (key === CACHE_KEY) throw new Error("quota exceeded");
      });

      const restored = new WebSessionStorage({}).restore();

      expect(restored.user?.accessToken).toBeUndefined();
      expect(restored.user?.provider).toBe("google");
    });

    it("restores scopes and removes invalid scope lists", () => {
      sessionStorage.setItem(SCOPES_KEY, JSON.stringify(["a", 3, "b"]));
      expect(new WebSessionStorage({}).restore().scopes).toEqual(["a", "b"]);

      sessionStorage.setItem(SCOPES_KEY, JSON.stringify({ not: "a list" }));
      expect(new WebSessionStorage({}).restore().scopes).toBeUndefined();
      expect(sessionStorage.getItem(SCOPES_KEY)).toBeNull();
    });
  });

  describe("sibling browser storage cleanup", () => {
    it("sanitizes a stale cache left in the other storage", () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify(fullUser));

      new WebSessionStorage({ nitroAuthWebStorage: "session" }).restore();

      expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}")).toEqual({
        provider: "google",
        email: "user@example.com",
        name: "User",
      });
    });

    it("leaves an already sanitized sibling cache untouched", () => {
      const sanitized = JSON.stringify({ provider: "google", email: "a@b.c" });
      localStorage.setItem(CACHE_KEY, sanitized);
      const setItem = jest.spyOn(Storage.prototype, "setItem");

      new WebSessionStorage({ nitroAuthWebStorage: "session" }).restore();

      expect(setItem).not.toHaveBeenCalledWith(CACHE_KEY, expect.anything());
      expect(localStorage.getItem(CACHE_KEY)).toBe(sanitized);
    });

    it.each([
      ["unparsable JSON", "not-json"],
      ["an invalid user", JSON.stringify({ provider: "github" })],
    ])("removes a sibling cache holding %s", (_label, cached) => {
      localStorage.setItem(CACHE_KEY, cached);

      new WebSessionStorage({ nitroAuthWebStorage: "session" }).restore();

      expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it("survives a sibling cache that cannot be rewritten or removed", () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify(fullUser));
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
      ) {
        if (this === window.localStorage) throw new Error("quota exceeded");
      });
      expect(() =>
        new WebSessionStorage({ nitroAuthWebStorage: "session" }).restore(),
      ).not.toThrow();

      jest.restoreAllMocks();
      localStorage.setItem(CACHE_KEY, "not-json");
      jest.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
        this: Storage,
      ) {
        if (this === window.localStorage) throw new Error("unavailable");
      });
      expect(() =>
        new WebSessionStorage({ nitroAuthWebStorage: "session" }).restore(),
      ).not.toThrow();
    });

    it("survives storage that throws on read", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
      ) {
        if (this === window.localStorage) throw new Error("denied");
        return null;
      });

      expect(() =>
        new WebSessionStorage({ nitroAuthWebStorage: "session" }).restore(),
      ).not.toThrow();
    });
  });

  describe("storage modes", () => {
    it("falls back to the session storage for an unknown configured mode", () => {
      const storage = new WebSessionStorage({
        nitroAuthWebStorage: "cookies" as never,
      });

      storage.saveScopes(["a"]);

      expect(sessionStorage.getItem(SCOPES_KEY)).toBe('["a"]');
    });

    it("uses local storage when configured", () => {
      new WebSessionStorage({ nitroAuthWebStorage: "local" }).saveScopes(["a"]);

      expect(localStorage.getItem(SCOPES_KEY)).toBe('["a"]');
    });

    it("keeps everything in memory in memory mode", () => {
      const storage = new WebSessionStorage({ nitroAuthWebStorage: "memory" });

      storage.saveScopes(["a"]);
      storage.saveUser({ provider: "google", email: "a@b.c" });

      expect(sessionStorage.getItem(SCOPES_KEY)).toBeNull();
      expect(localStorage.getItem(SCOPES_KEY)).toBeNull();
      expect(storage.restore().scopes).toEqual(["a"]);
      storage.clearSession();
      expect(storage.restore()).toEqual({});
    });

    it("falls back to memory when the configured storage rejects writes", () => {
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const storage = new WebSessionStorage({});

      storage.saveScopes(["a"]);

      expect(storage.restore().scopes).toEqual(["a"]);
      storage.clearSession();
      expect(storage.restore().scopes).toBeUndefined();
    });
  });

  describe("refresh token", () => {
    it("stays in memory by default and never reaches browser storage", () => {
      const storage = new WebSessionStorage({});

      storage.saveRefreshToken("r1");

      expect(storage.loadRefreshToken()).toBe("r1");
      expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
      expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    });

    it("persists to the configured browser storage when enabled", () => {
      const storage = new WebSessionStorage({
        nitroAuthPersistTokensOnWeb: true,
        nitroAuthWebStorage: "local",
      });

      storage.saveRefreshToken("r1");

      expect(localStorage.getItem(REFRESH_KEY)).toBe("r1");
      expect(storage.loadRefreshToken()).toBe("r1");
      storage.clearRefreshToken();
      expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
      expect(storage.loadRefreshToken()).toBeUndefined();
    });

    it("removes stale persisted refresh tokens when persistence is off", () => {
      localStorage.setItem(REFRESH_KEY, "legacy");
      sessionStorage.setItem(REFRESH_KEY, "legacy");

      new WebSessionStorage({}).restore();

      expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
      expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
    });

    it("tolerates storage that refuses removal of persisted tokens", () => {
      jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("denied");
      });

      expect(() => new WebSessionStorage({}).restore()).not.toThrow();
    });
  });
});

describe("getSafeErrorCategory", () => {
  it("reports an auth error by its code", () => {
    expect(getSafeErrorCategory(new AuthWebError("timeout"))).toBe("timeout");
  });

  it.each([
    "AbortError",
    "InvalidStateError",
    "NetworkError",
    "NotAllowedError",
    "NotReadableError",
    "QuotaExceededError",
    "SecurityError",
    "TimeoutError",
  ])("keeps the well-known browser error name %s", (name) => {
    const error = new Error("detail");
    error.name = name;
    expect(getSafeErrorCategory(error)).toBe(name);
  });

  it("hides custom error names and non-error values", () => {
    const custom = new Error("secret detail");
    custom.name = "AccountNumber42";
    expect(getSafeErrorCategory(custom)).toBe("Error");
    expect(getSafeErrorCategory("text")).toBe("UnknownError");
    expect(getSafeErrorCategory(undefined)).toBe("UnknownError");
  });

  it("never throws for hostile values", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    expect(getSafeErrorCategory(hostile)).toBe("UnknownError");
  });

  it("exposes the underlying detail on AuthWebError", () => {
    const error = new AuthWebError("network_error", "offline");
    expect(error.name).toBe("AuthWebError");
    expect(error.underlyingError).toBe("offline");
  });
});

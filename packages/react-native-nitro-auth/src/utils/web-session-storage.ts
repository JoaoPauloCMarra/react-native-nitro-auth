import { getSafeErrorCategory } from "./auth-web-error";
import { logger } from "./logger";
import {
  getOptionalNumber,
  getOptionalString,
  isAuthProvider,
  isJsonObject,
  setIfDefined,
  type JsonObject,
} from "./web-json";
import type { AuthUser } from "../Auth.nitro";

const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const MS_REFRESH_TOKEN_KEY = "nitro_auth_microsoft_refresh_token";

export const STORAGE_MODE_SESSION = "session";
export const STORAGE_MODE_LOCAL = "local";
export const STORAGE_MODE_MEMORY = "memory";

const WEB_CREDENTIAL_FIELDS = [
  "accessToken",
  "idToken",
  "serverAuthCode",
  "authorizationCode",
  "refreshToken",
] as const;
const WEB_PROFILE_FIELDS = [
  "email",
  "name",
  "firstName",
  "lastName",
  "photo",
] as const;
const WEB_STORAGE_MODES = new Set([
  STORAGE_MODE_SESSION,
  STORAGE_MODE_LOCAL,
  STORAGE_MODE_MEMORY,
] as const);

const inMemoryWebStorage = new Map<string, string>();

const parseAuthUser = (value: unknown): AuthUser | undefined => {
  if (!isJsonObject(value) || !isAuthProvider(value.provider)) {
    return undefined;
  }

  const scopesCandidate = value.scopes;
  const scopes = Array.isArray(scopesCandidate)
    ? scopesCandidate.filter(
        (scope): scope is string => typeof scope === "string",
      )
    : undefined;

  const user: AuthUser = {
    provider: value.provider,
  };
  setIfDefined(user, "email", getOptionalString(value, "email"));
  setIfDefined(user, "name", getOptionalString(value, "name"));
  setIfDefined(user, "firstName", getOptionalString(value, "firstName"));
  setIfDefined(user, "lastName", getOptionalString(value, "lastName"));
  setIfDefined(user, "photo", getOptionalString(value, "photo"));
  setIfDefined(user, "idToken", getOptionalString(value, "idToken"));
  setIfDefined(user, "accessToken", getOptionalString(value, "accessToken"));
  setIfDefined(user, "refreshToken", getOptionalString(value, "refreshToken"));
  setIfDefined(
    user,
    "serverAuthCode",
    getOptionalString(value, "serverAuthCode"),
  );
  setIfDefined(
    user,
    "authorizationCode",
    getOptionalString(value, "authorizationCode"),
  );
  setIfDefined(user, "userId", getOptionalString(value, "userId"));
  setIfDefined(user, "phoneNumber", getOptionalString(value, "phoneNumber"));
  setIfDefined(user, "hostedDomain", getOptionalString(value, "hostedDomain"));
  setIfDefined(user, "scopes", scopes);
  setIfDefined(
    user,
    "expirationTime",
    getOptionalNumber(value, "expirationTime"),
  );
  setIfDefined(
    user,
    "underlyingError",
    getOptionalString(value, "underlyingError"),
  );
  return user;
};

const parseScopes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((scope): scope is string => typeof scope === "string");
};

export type WebSessionStorageConfig = {
  nitroAuthWebStorage?: "session" | "local" | "memory";
  nitroAuthPersistTokensOnWeb?: boolean;
  nitroAuthPersistProfileOnWeb?: boolean;
};

export class WebSessionStorage {
  private _browserStorageResolved = false;
  private _browserStorageCache: Storage | undefined;

  constructor(private readonly _config: WebSessionStorageConfig) {}

  private shouldPersistTokens(): boolean {
    return this._config.nitroAuthPersistTokensOnWeb === true;
  }

  private shouldPersistProfile(): boolean {
    return this._config.nitroAuthPersistProfileOnWeb !== false;
  }

  private getWebStorageMode(): "session" | "local" | "memory" {
    const configuredMode = this._config.nitroAuthWebStorage;
    if (configuredMode && WEB_STORAGE_MODES.has(configuredMode)) {
      return configuredMode;
    }
    return STORAGE_MODE_SESSION;
  }

  private getBrowserStorage(): Storage | undefined {
    if (this._browserStorageResolved) {
      return this._browserStorageCache;
    }

    this._browserStorageResolved = true;
    if (typeof window === "undefined") {
      this._browserStorageCache = undefined;
      return undefined;
    }

    const mode = this.getWebStorageMode();
    if (mode === STORAGE_MODE_MEMORY) {
      this._browserStorageCache = undefined;
      return undefined;
    }

    try {
      const storage =
        mode === STORAGE_MODE_LOCAL
          ? window.localStorage
          : window.sessionStorage;
      const testKey = "__nitro_auth_storage_probe__";
      storage.setItem(testKey, "1");
      storage.removeItem(testKey);
      this._browserStorageCache = storage;
      return storage;
    } catch (error) {
      logger.warn(
        "Configured web storage is unavailable; using in-memory fallback",
        {
          mode,
          error: getSafeErrorCategory(error),
        },
      );
      this._browserStorageCache = undefined;
      return undefined;
    }
  }

  private saveValue(key: string, value: string): void {
    const storage = this.getBrowserStorage();
    if (storage) {
      storage.setItem(key, value);
      return;
    }
    inMemoryWebStorage.set(key, value);
  }

  private loadValue(key: string): string | undefined {
    const storage = this.getBrowserStorage();
    if (storage) {
      return storage.getItem(key) ?? undefined;
    }
    return inMemoryWebStorage.get(key);
  }

  private removeValue(key: string): void {
    const storage = this.getBrowserStorage();
    if (storage) {
      storage.removeItem(key);
      return;
    }
    inMemoryWebStorage.delete(key);
  }

  private removePersistedBrowserValue(key: string): void {
    if (typeof window === "undefined") {
      return;
    }

    for (const mode of [STORAGE_MODE_LOCAL, STORAGE_MODE_SESSION] as const) {
      try {
        const storage =
          mode === STORAGE_MODE_LOCAL
            ? window.localStorage
            : window.sessionStorage;
        storage.removeItem(key);
      } catch (error) {
        logger.debug("Failed to clear persisted browser value", {
          key,
          mode,
          error: getSafeErrorCategory(error),
        });
      }
    }
  }

  private sanitizeOtherBrowserUserCaches(
    selectedBrowserMode:
      typeof STORAGE_MODE_LOCAL | typeof STORAGE_MODE_SESSION | undefined,
  ): void {
    if (typeof window === "undefined") {
      return;
    }

    for (const mode of [STORAGE_MODE_LOCAL, STORAGE_MODE_SESSION] as const) {
      if (mode === selectedBrowserMode) {
        continue;
      }

      let storage: Storage;
      let cached: string | null;
      try {
        storage =
          mode === STORAGE_MODE_LOCAL
            ? window.localStorage
            : window.sessionStorage;
        cached = storage.getItem(CACHE_KEY);
      } catch (error) {
        logger.warn("Failed to inspect cached auth user in browser storage", {
          mode,
          error: getSafeErrorCategory(error),
        });
        continue;
      }

      if (cached === null) {
        continue;
      }

      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(cached);
      } catch (error) {
        logger.warn(
          "Failed to parse cached auth user in browser storage; removing it",
          { mode, error: getSafeErrorCategory(error) },
        );
        this.removeInvalidBrowserUserCache(storage, mode);
        continue;
      }

      if (!isJsonObject(parsedValue) || !parseAuthUser(parsedValue)) {
        logger.warn(
          "Invalid cached auth user in browser storage; removing it",
          {
            mode,
          },
        );
        this.removeInvalidBrowserUserCache(storage, mode);
        continue;
      }

      const sanitizedCache = JSON.stringify(
        this.sanitizeUserForPersistence(parsedValue),
      );
      if (sanitizedCache === cached) {
        continue;
      }

      try {
        storage.setItem(CACHE_KEY, sanitizedCache);
      } catch (error) {
        logger.warn(
          "Failed to sanitize cached auth user in browser storage; sensitive fields may remain persisted",
          { mode, error: getSafeErrorCategory(error) },
        );
      }
    }
  }

  private removeInvalidBrowserUserCache(
    storage: Storage,
    mode: typeof STORAGE_MODE_LOCAL | typeof STORAGE_MODE_SESSION,
  ): void {
    try {
      storage.removeItem(CACHE_KEY);
    } catch (error) {
      logger.warn(
        "Failed to remove invalid cached auth user from browser storage",
        { mode, error: getSafeErrorCategory(error) },
      );
    }
  }

  private sanitizeUserForPersistence(user: AuthUser): AuthUser;
  private sanitizeUserForPersistence(user: JsonObject): JsonObject;
  private sanitizeUserForPersistence(
    user: AuthUser | JsonObject,
  ): AuthUser | JsonObject {
    const safeUser = { ...user };
    if (!this.shouldPersistTokens()) {
      for (const field of WEB_CREDENTIAL_FIELDS) {
        Reflect.deleteProperty(safeUser, field);
      }
    }
    if (!this.shouldPersistProfile()) {
      for (const field of WEB_PROFILE_FIELDS) {
        Reflect.deleteProperty(safeUser, field);
      }
    }
    return safeUser;
  }

  private removeInvalidCacheValue(key: string): void {
    try {
      this.removeValue(key);
    } catch (error) {
      logger.warn("Failed to remove invalid cached auth data", {
        key,
        error: getSafeErrorCategory(error),
      });
    }
  }

  saveRefreshToken(refreshToken: string): void {
    if (this.shouldPersistTokens()) {
      this.saveValue(MS_REFRESH_TOKEN_KEY, refreshToken);
      return;
    }

    // Security-first default: keep refresh tokens in-memory only on web.
    inMemoryWebStorage.set(MS_REFRESH_TOKEN_KEY, refreshToken);
  }

  loadRefreshToken(): string | undefined {
    if (this.shouldPersistTokens()) {
      return this.loadValue(MS_REFRESH_TOKEN_KEY);
    }
    return inMemoryWebStorage.get(MS_REFRESH_TOKEN_KEY);
  }

  saveUser(user: AuthUser): void {
    this.saveValue(
      CACHE_KEY,
      JSON.stringify(this.sanitizeUserForPersistence(user)),
    );
  }

  saveScopes(scopes: string[]): void {
    this.saveValue(SCOPES_KEY, JSON.stringify(scopes));
  }

  clearRefreshToken(): void {
    this.removeValue(MS_REFRESH_TOKEN_KEY);
    inMemoryWebStorage.delete(MS_REFRESH_TOKEN_KEY);
  }

  clearSession(): void {
    this.removeValue(CACHE_KEY);
    this.removeValue(SCOPES_KEY);
    this.clearRefreshToken();
  }

  restore(): { user?: AuthUser; scopes?: string[] } {
    const restored: { user?: AuthUser; scopes?: string[] } = {};
    const cached = this.loadValue(CACHE_KEY);

    if (cached !== undefined) {
      try {
        const parsedValue: unknown = JSON.parse(cached);
        if (!isJsonObject(parsedValue)) {
          throw new Error("Expected cached auth user to be an object");
        }
        const parsedUser = parseAuthUser(parsedValue);
        if (!parsedUser) {
          throw new Error("Expected cached auth user to be a valid AuthUser");
        }

        const safeRecord = this.sanitizeUserForPersistence(parsedValue);
        const sanitizedCache = JSON.stringify(safeRecord);
        if (sanitizedCache !== cached) {
          try {
            this.saveValue(CACHE_KEY, sanitizedCache);
          } catch (error) {
            logger.warn(
              "Failed to sanitize cached auth user; keeping the in-memory session safe",
              { error: getSafeErrorCategory(error) },
            );
          }
        }

        restored.user = this.sanitizeUserForPersistence(parsedUser);
      } catch (error) {
        logger.warn("Failed to parse cached auth user; clearing cache", {
          error: getSafeErrorCategory(error),
        });
        this.removeInvalidCacheValue(CACHE_KEY);
      }
    }

    const scopes = this.loadValue(SCOPES_KEY);

    if (scopes) {
      try {
        const parsedScopes = parseScopes(JSON.parse(scopes));
        if (!parsedScopes) {
          throw new Error("Expected cached scopes to be an array");
        }
        restored.scopes = parsedScopes;
      } catch (error) {
        logger.warn("Failed to parse cached scopes; clearing cache", {
          error: getSafeErrorCategory(error),
        });
        this.removeInvalidCacheValue(SCOPES_KEY);
      }
    }

    const configuredStorageMode = this.getWebStorageMode();
    const selectedBrowserMode =
      configuredStorageMode === STORAGE_MODE_MEMORY
        ? undefined
        : configuredStorageMode;
    this.sanitizeOtherBrowserUserCaches(selectedBrowserMode);

    if (!this.shouldPersistTokens()) {
      this.removePersistedBrowserValue(MS_REFRESH_TOKEN_KEY);
      inMemoryWebStorage.delete(MS_REFRESH_TOKEN_KEY);
    }

    return restored;
  }
}

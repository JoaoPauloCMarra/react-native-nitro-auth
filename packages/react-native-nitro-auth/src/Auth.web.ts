import type {
  Auth,
  AuthUser,
  AuthProvider,
  LoginOptions,
  AuthTokens,
} from "./Auth.nitro";
import type { JSStorageAdapter } from "./js-storage-adapter";
import { logger } from "./utils/logger";

const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const MS_REFRESH_TOKEN_KEY = "nitro_auth_microsoft_refresh_token";
const DEFAULT_SCOPES = ["openid", "email", "profile"];
const MS_DEFAULT_SCOPES = ["openid", "email", "profile", "User.Read"];
const STORAGE_MODE_SESSION = "session";
const STORAGE_MODE_LOCAL = "local";
const STORAGE_MODE_MEMORY = "memory";
const POPUP_POLL_INTERVAL_MS = 100;
const POPUP_TIMEOUT_MS = 120000;
const WEB_STORAGE_MODES = new Set([
  STORAGE_MODE_SESSION,
  STORAGE_MODE_LOCAL,
  STORAGE_MODE_MEMORY,
] as const);
const inMemoryWebStorage = new Map<string, string>();

type WebStorageDriver = {
  save(key: string, value: string): void;
  load(key: string): string | undefined;
  remove(key: string): void;
};

type AppleAuthResponse = {
  authorization: {
    id_token: string;
  };
  user?: {
    email?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
};

type AuthWebExtraConfig = {
  googleWebClientId?: string;
  microsoftClientId?: string;
  microsoftTenant?: string;
  microsoftB2cDomain?: string;
  appleWebClientId?: string;
  nitroAuthWebStorage?: "session" | "local" | "memory";
  nitroAuthPersistTokensOnWeb?: boolean;
};

type JsonObject = Record<string, unknown>;

class AuthWebError extends Error {
  public readonly underlyingError?: string;

  constructor(message: string, underlyingError?: string) {
    super(message);
    this.name = "AuthWebError";
    this.underlyingError = underlyingError;
  }
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null;

const isAuthProvider = (value: unknown): value is AuthProvider =>
  value === "google" || value === "apple" || value === "microsoft";

const getOptionalString = (
  source: JsonObject,
  key: string,
): string | undefined => {
  const candidate = source[key];
  return typeof candidate === "string" ? candidate : undefined;
};

const getOptionalNumber = (
  source: JsonObject,
  key: string,
): number | undefined => {
  const candidate = source[key];
  return typeof candidate === "number" ? candidate : undefined;
};

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

  return {
    provider: value.provider,
    email: getOptionalString(value, "email"),
    name: getOptionalString(value, "name"),
    photo: getOptionalString(value, "photo"),
    idToken: getOptionalString(value, "idToken"),
    accessToken: getOptionalString(value, "accessToken"),
    refreshToken: getOptionalString(value, "refreshToken"),
    serverAuthCode: getOptionalString(value, "serverAuthCode"),
    scopes,
    expirationTime: getOptionalNumber(value, "expirationTime"),
    underlyingError: getOptionalString(value, "underlyingError"),
  };
};

const parseScopes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((scope): scope is string => typeof scope === "string");
};

const parseAuthWebExtraConfig = (value: unknown): AuthWebExtraConfig => {
  if (!isJsonObject(value)) {
    return {};
  }

  const nitroAuthWebStorageCandidate = value.nitroAuthWebStorage;
  const nitroAuthWebStorage =
    nitroAuthWebStorageCandidate === STORAGE_MODE_SESSION ||
    nitroAuthWebStorageCandidate === STORAGE_MODE_LOCAL ||
    nitroAuthWebStorageCandidate === STORAGE_MODE_MEMORY
      ? nitroAuthWebStorageCandidate
      : undefined;

  return {
    googleWebClientId: getOptionalString(value, "googleWebClientId"),
    microsoftClientId: getOptionalString(value, "microsoftClientId"),
    microsoftTenant: getOptionalString(value, "microsoftTenant"),
    microsoftB2cDomain: getOptionalString(value, "microsoftB2cDomain"),
    appleWebClientId: getOptionalString(value, "appleWebClientId"),
    nitroAuthWebStorage,
    nitroAuthPersistTokensOnWeb:
      typeof value.nitroAuthPersistTokensOnWeb === "boolean"
        ? value.nitroAuthPersistTokensOnWeb
        : undefined,
  };
};

const getConfig = (): AuthWebExtraConfig => {
  try {
    const Constants = require("expo-constants").default;
    return parseAuthWebExtraConfig(Constants.expoConfig?.extra);
  } catch (error) {
    logger.debug(
      "expo-constants unavailable on web, falling back to defaults",
      {
        error: String(error),
      },
    );
    return {};
  }
};

class AuthWeb implements Auth {
  private _currentUser: AuthUser | undefined;
  private _grantedScopes: string[] = [];
  private _listeners: ((user: AuthUser | undefined) => void)[] = [];
  private _tokenListeners: ((tokens: AuthTokens) => void)[] = [];
  private _storageAdapter: WebStorageDriver | undefined;

  constructor() {
    this.loadFromCache();
  }

  private isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if (!isJsonObject(value)) {
      return false;
    }
    return typeof value.then === "function";
  }

  private createWebStorageDriver(adapter: JSStorageAdapter): WebStorageDriver {
    return {
      save: (key, value) => {
        const result = adapter.save(key, value);
        if (this.isPromiseLike(result)) {
          throw new Error("On web, JSStorageAdapter.save must be synchronous.");
        }
      },
      load: (key) => {
        const result = adapter.load(key);
        if (this.isPromiseLike(result)) {
          throw new Error("On web, JSStorageAdapter.load must be synchronous.");
        }
        return result;
      },
      remove: (key) => {
        const result = adapter.remove(key);
        if (this.isPromiseLike(result)) {
          throw new Error(
            "On web, JSStorageAdapter.remove must be synchronous.",
          );
        }
      },
    };
  }

  private shouldPersistTokensInStorage(): boolean {
    if (this._storageAdapter) {
      return true;
    }
    return getConfig().nitroAuthPersistTokensOnWeb === true;
  }

  private getWebStorageMode(): "session" | "local" | "memory" {
    const configuredMode = getConfig().nitroAuthWebStorage;
    if (configuredMode && WEB_STORAGE_MODES.has(configuredMode)) {
      return configuredMode;
    }
    return STORAGE_MODE_SESSION;
  }

  private getBrowserStorage(): Storage | undefined {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mode = this.getWebStorageMode();
    if (mode === STORAGE_MODE_MEMORY) {
      return undefined;
    }

    const storage =
      mode === STORAGE_MODE_LOCAL ? window.localStorage : window.sessionStorage;
    try {
      const testKey = "__nitro_auth_storage_probe__";
      storage.setItem(testKey, "1");
      storage.removeItem(testKey);
      return storage;
    } catch (error) {
      logger.warn(
        "Configured web storage is unavailable; using in-memory fallback",
        {
          mode,
          error: String(error),
        },
      );
      return undefined;
    }
  }

  private saveValue(key: string, value: string): void {
    if (this._storageAdapter) {
      this._storageAdapter.save(key, value);
      return;
    }

    const storage = this.getBrowserStorage();
    if (storage) {
      storage.setItem(key, value);
      return;
    }
    inMemoryWebStorage.set(key, value);
  }

  private loadValue(key: string): string | undefined {
    if (this._storageAdapter) {
      return this._storageAdapter.load(key);
    }

    const storage = this.getBrowserStorage();
    if (storage) {
      return storage.getItem(key) ?? undefined;
    }
    return inMemoryWebStorage.get(key);
  }

  private removeValue(key: string): void {
    if (this._storageAdapter) {
      this._storageAdapter.remove(key);
      return;
    }

    const storage = this.getBrowserStorage();
    if (storage) {
      storage.removeItem(key);
    }
    inMemoryWebStorage.delete(key);
  }

  private removePersistedBrowserValue(key: string): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch (error) {
      logger.debug("Failed to clear persisted browser value", {
        key,
        error: String(error),
      });
    }
  }

  private sanitizeUserForPersistence(user: AuthUser): AuthUser {
    if (this.shouldPersistTokensInStorage()) {
      return user;
    }

    const safeUser = { ...user };
    delete safeUser.accessToken;
    delete safeUser.idToken;
    delete safeUser.serverAuthCode;
    return safeUser;
  }

  private saveRefreshToken(refreshToken: string): void {
    if (this._storageAdapter || this.shouldPersistTokensInStorage()) {
      this.saveValue(MS_REFRESH_TOKEN_KEY, refreshToken);
      return;
    }

    // Security-first default: keep refresh tokens in-memory only on web.
    inMemoryWebStorage.set(MS_REFRESH_TOKEN_KEY, refreshToken);
  }

  private loadRefreshToken(): string | undefined {
    if (this._storageAdapter || this.shouldPersistTokensInStorage()) {
      return this.loadValue(MS_REFRESH_TOKEN_KEY);
    }
    return inMemoryWebStorage.get(MS_REFRESH_TOKEN_KEY);
  }

  private loadFromCache() {
    const cached = this.loadValue(CACHE_KEY);

    if (cached) {
      try {
        const parsedUser = parseAuthUser(JSON.parse(cached));
        if (!parsedUser) {
          throw new Error("Expected cached auth user to be a valid AuthUser");
        }
        if (this.shouldPersistTokensInStorage()) {
          this._currentUser = parsedUser;
        } else {
          const safeUser = { ...parsedUser };
          delete safeUser.accessToken;
          delete safeUser.idToken;
          delete safeUser.serverAuthCode;
          this._currentUser = safeUser;
        }
      } catch (error) {
        logger.warn("Failed to parse cached auth user; clearing cache", {
          error: String(error),
        });
        this.removeFromCache(CACHE_KEY);
      }
    }

    const scopes = this.loadValue(SCOPES_KEY);

    if (scopes) {
      try {
        const parsedScopes = parseScopes(JSON.parse(scopes));
        if (!parsedScopes) {
          throw new Error("Expected cached scopes to be an array");
        }
        this._grantedScopes = parsedScopes;
      } catch (error) {
        logger.warn("Failed to parse cached scopes; clearing cache", {
          error: String(error),
        });
        this.removeFromCache(SCOPES_KEY);
      }
    }

    if (!this.shouldPersistTokensInStorage() && !this._storageAdapter) {
      this.removePersistedBrowserValue(MS_REFRESH_TOKEN_KEY);
    }
  }

  private removeFromCache(key: string) {
    this.removeValue(key);
  }

  get currentUser(): AuthUser | undefined {
    return this._currentUser;
  }

  get grantedScopes(): string[] {
    return this._grantedScopes;
  }

  get hasPlayServices(): boolean {
    return true;
  }

  onAuthStateChanged(
    callback: (user: AuthUser | undefined) => void,
  ): () => void {
    this._listeners.push(callback);
    callback(this._currentUser);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== callback);
    };
  }

  onTokensRefreshed(callback: (tokens: AuthTokens) => void): () => void {
    this._tokenListeners.push(callback);
    return () => {
      this._tokenListeners = this._tokenListeners.filter((l) => l !== callback);
    };
  }

  private notify() {
    this._listeners.forEach((l) => {
      l(this._currentUser);
    });
  }

  async login(provider: AuthProvider, options?: LoginOptions): Promise<void> {
    const loginHint = options?.loginHint;
    logger.log(`Starting login with ${provider}`, { scopes: options?.scopes });
    try {
      if (provider === "google") {
        const scopes = options?.scopes ?? DEFAULT_SCOPES;
        await this.loginGoogle(scopes, loginHint);
      } else if (provider === "microsoft") {
        const scopes = options?.scopes ?? MS_DEFAULT_SCOPES;
        await this.loginMicrosoft(
          scopes,
          loginHint,
          options?.tenant,
          options?.prompt,
        );
      } else {
        await this.loginApple();
      }
      logger.log(`Login successful with ${provider}`);
    } catch (e: unknown) {
      const error = this.mapError(e);
      logger.error(`Login failed for ${provider}:`, error.message);
      throw error;
    }
  }

  async requestScopes(scopes: string[]): Promise<void> {
    if (!this._currentUser) {
      throw new Error("No user logged in");
    }
    const provider = this._currentUser.provider;
    if (provider !== "google" && provider !== "microsoft") {
      throw new Error(
        "Scope management only supported for Google and Microsoft",
      );
    }
    logger.log("Requesting additional scopes:", scopes);
    const newScopes = [...new Set([...this._grantedScopes, ...scopes])];
    try {
      if (provider === "google") {
        await this.loginGoogle(newScopes);
      } else {
        await this.loginMicrosoft(newScopes);
      }
    } catch (e) {
      const error = this.mapError(e);
      logger.error("Requesting scopes failed:", error.message);
      throw error;
    }
  }

  async revokeScopes(scopes: string[]): Promise<void> {
    logger.log("Revoking scopes:", scopes);
    this._grantedScopes = this._grantedScopes.filter(
      (s) => !scopes.includes(s),
    );
    this.saveValue(SCOPES_KEY, JSON.stringify(this._grantedScopes));
    if (this._currentUser) {
      this._currentUser.scopes = this._grantedScopes;
      this.updateUser(this._currentUser);
    }
  }

  async getAccessToken(): Promise<string | undefined> {
    if (this._currentUser?.expirationTime) {
      const now = Date.now();
      if (now + 300000 > this._currentUser.expirationTime) {
        logger.log("Token about to expire, refreshing...");
        await this.refreshToken();
      }
    }
    return this._currentUser?.accessToken;
  }

  async refreshToken(): Promise<AuthTokens> {
    if (!this._currentUser) {
      throw new Error("No user logged in");
    }

    if (this._currentUser.provider === "microsoft") {
      logger.log("Refreshing Microsoft tokens...");
      const refreshToken = this.loadRefreshToken();

      if (!refreshToken) {
        throw new Error("No refresh token available");
      }

      const config = getConfig();
      const clientId = config.microsoftClientId;
      if (!clientId) {
        throw new Error(
          "Microsoft Client ID not configured. Add 'microsoftClientId' to expo.extra in your app.config.js",
        );
      }
      const tenant = config.microsoftTenant ?? "common";
      const b2cDomain = config.microsoftB2cDomain;

      const authBaseUrl = this.getMicrosoftAuthBaseUrl(tenant, b2cDomain);
      const tokenUrl = `${authBaseUrl}oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const json = await this.parseResponseObject(response);
      if (!response.ok) {
        throw new Error(
          getOptionalString(json, "error_description") ??
            getOptionalString(json, "error") ??
            "Token refresh failed",
        );
      }

      const idToken = getOptionalString(json, "id_token");
      const accessToken = getOptionalString(json, "access_token");
      const newRefreshToken = getOptionalString(json, "refresh_token");
      const expiresInSeconds = getOptionalNumber(json, "expires_in");

      if (newRefreshToken) {
        this.saveRefreshToken(newRefreshToken);
      }

      const expirationTime =
        typeof expiresInSeconds === "number"
          ? Date.now() + expiresInSeconds * 1000
          : undefined;

      const effectiveIdToken = idToken ?? this._currentUser.idToken;
      const claims = effectiveIdToken
        ? this.decodeMicrosoftJwt(effectiveIdToken)
        : {};
      const user: AuthUser = {
        ...this._currentUser,
        idToken: effectiveIdToken,
        accessToken: accessToken ?? undefined,
        refreshToken: newRefreshToken ?? this._currentUser.refreshToken,
        expirationTime,
        ...claims,
      };
      this.updateUser(user);

      const tokens: AuthTokens = {
        accessToken: accessToken ?? undefined,
        idToken: effectiveIdToken,
        refreshToken: newRefreshToken ?? undefined,
        expirationTime,
      };
      this._tokenListeners.forEach((l) => {
        l(tokens);
      });
      return tokens;
    }

    if (this._currentUser.provider !== "google") {
      throw new Error(
        `Token refresh not supported for ${this._currentUser.provider}`,
      );
    }

    logger.log("Refreshing tokens...");
    await this.loginGoogle(
      this._grantedScopes.length > 0 ? this._grantedScopes : DEFAULT_SCOPES,
    );
    const tokens: AuthTokens = {
      accessToken: this._currentUser.accessToken,
      idToken: this._currentUser.idToken,
      refreshToken: this._currentUser.refreshToken,
      expirationTime: this._currentUser.expirationTime,
    };
    this._tokenListeners.forEach((l) => {
      l(tokens);
    });
    return tokens;
  }

  private mapError(error: unknown): Error {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const msg = rawMessage.toLowerCase();
    let mappedMsg = rawMessage;

    if (msg.includes("cancel") || msg.includes("popup_closed")) {
      mappedMsg = "cancelled";
    } else if (msg.includes("timeout")) {
      mappedMsg = "timeout";
    } else if (msg.includes("popup blocked")) {
      mappedMsg = "popup_blocked";
    } else if (msg.includes("network")) {
      mappedMsg = "network_error";
    } else if (msg.includes("client id") || msg.includes("config")) {
      mappedMsg = "configuration_error";
    }

    return new AuthWebError(mappedMsg, rawMessage);
  }

  private async parseResponseObject(response: Response): Promise<JsonObject> {
    const parsed: unknown = await response.json();
    if (!isJsonObject(parsed)) {
      throw new Error("Expected JSON object response from auth provider");
    }
    return parsed;
  }

  private parseJwtPayload(token: string): JsonObject {
    const payload = token.split(".")[1];
    if (!payload) {
      throw new Error("Invalid JWT payload");
    }

    const decoded: unknown = JSON.parse(atob(payload));
    if (!isJsonObject(decoded)) {
      throw new Error("Expected JWT payload to be an object");
    }
    return decoded;
  }

  private waitForPopupRedirect(
    popup: Window,
    redirectUri: string,
    provider: "Google" | "Microsoft",
    onRedirect: (url: string) => Promise<void> | void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let crossOriginLogShown = false;

      const cleanup = (
        intervalId: number,
        timeoutId: number,
        shouldClosePopup: boolean,
      ) => {
        window.clearInterval(intervalId);
        window.clearTimeout(timeoutId);
        if (shouldClosePopup && !popup.closed) {
          popup.close();
        }
      };

      const timeoutId = window.setTimeout(() => {
        cleanup(intervalId, timeoutId, true);
        reject(new Error(`${provider.toLowerCase()}_auth_timeout`));
      }, POPUP_TIMEOUT_MS);

      const intervalId = window.setInterval(() => {
        if (popup.closed) {
          cleanup(intervalId, timeoutId, false);
          reject(new Error("cancelled"));
          return;
        }

        let url: string;
        try {
          url = popup.location.href;
        } catch (error) {
          if (!crossOriginLogShown) {
            logger.debug(`Waiting for ${provider} auth redirect`, {
              error: String(error),
            });
            crossOriginLogShown = true;
          }
          return;
        }

        if (!url.startsWith(redirectUri)) {
          return;
        }

        cleanup(intervalId, timeoutId, true);
        void Promise.resolve(onRedirect(url))
          .then(() => {
            resolve();
          })
          .catch((error: unknown) => {
            reject(error);
          });
      }, POPUP_POLL_INTERVAL_MS);
    });
  }

  private async loginGoogle(
    scopes: string[],
    loginHint?: string,
  ): Promise<void> {
    const config = getConfig();
    const clientId = config.googleWebClientId;

    if (!clientId) {
      throw new Error(
        "Google Web Client ID not configured. Add 'GOOGLE_WEB_CLIENT_ID' to your .env file.",
      );
    }

    return new Promise((resolve, reject) => {
      const redirectUri = window.location.origin;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "id_token token code");
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("nonce", crypto.randomUUID());
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      if (loginHint) {
        authUrl.searchParams.set("login_hint", loginHint);
      }

      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl.toString(),
        "google-auth",
        `width=${width},height=${height},left=${left},top=${top}`,
      );

      if (!popup) {
        reject(new Error("Popup blocked. Please allow popups for this site."));
        return;
      }

      void this.waitForPopupRedirect(popup, redirectUri, "Google", (url) => {
        const hash = new URL(url).hash.slice(1);
        const params = new URLSearchParams(hash);
        const idToken = params.get("id_token");
        const accessToken = params.get("access_token");
        const expiresIn = params.get("expires_in");
        const code = params.get("code");

        if (!idToken) {
          throw new Error("No id_token in response");
        }

        this._grantedScopes = scopes;
        this.saveValue(SCOPES_KEY, JSON.stringify(scopes));

        const user: AuthUser = {
          provider: "google",
          idToken,
          accessToken: accessToken ?? undefined,
          serverAuthCode: code ?? undefined,
          scopes,
          expirationTime: expiresIn
            ? Date.now() + parseInt(expiresIn, 10) * 1000
            : undefined,
          ...this.decodeGoogleJwt(idToken),
        };
        this.updateUser(user);
      })
        .then(() => {
          resolve();
        })
        .catch((error: unknown) => {
          reject(error);
        });
    });
  }

  private decodeGoogleJwt(token: string): Partial<AuthUser> {
    try {
      const decoded = this.parseJwtPayload(token);
      return {
        email: getOptionalString(decoded, "email"),
        name: getOptionalString(decoded, "name"),
        photo: getOptionalString(decoded, "picture"),
      };
    } catch (error) {
      logger.warn("Failed to decode Google ID token", { error: String(error) });
      return {};
    }
  }

  private async loginMicrosoft(
    scopes: string[],
    loginHint?: string,
    tenant?: string,
    prompt?: string,
  ): Promise<void> {
    const config = getConfig();
    const clientId = config.microsoftClientId;

    if (!clientId) {
      throw new Error(
        "Microsoft Client ID not configured. Add 'microsoftClientId' to expo.extra in your app.config.js",
      );
    }

    const effectiveTenant = tenant ?? config.microsoftTenant ?? "common";
    const b2cDomain = config.microsoftB2cDomain;
    const authBaseUrl = this.getMicrosoftAuthBaseUrl(
      effectiveTenant,
      b2cDomain,
    );

    const effectiveScopes = scopes.length
      ? scopes
      : ["openid", "email", "profile", "offline_access", "User.Read"];

    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const redirectUri = window.location.origin;
      const authUrl = new URL(`${authBaseUrl}oauth2/v2.0/authorize`);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("response_mode", "query");
      authUrl.searchParams.set("scope", effectiveScopes.join(" "));
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("nonce", nonce);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("prompt", prompt ?? "select_account");

      if (loginHint) {
        authUrl.searchParams.set("login_hint", loginHint);
      }

      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl.toString(),
        "microsoft-auth",
        `width=${width},height=${height},left=${left},top=${top}`,
      );

      if (!popup) {
        reject(new Error("Popup blocked. Please allow popups for this site."));
        return;
      }

      void this.waitForPopupRedirect(
        popup,
        redirectUri,
        "Microsoft",
        async (url) => {
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get("code");
          const returnedState = urlObj.searchParams.get("state");
          const error = urlObj.searchParams.get("error");
          const errorDescription = urlObj.searchParams.get("error_description");

          if (error) {
            throw new Error(errorDescription ?? error);
          }

          if (returnedState !== state) {
            throw new Error("State mismatch - possible CSRF attack");
          }

          if (!code) {
            throw new Error("No authorization code in response");
          }

          await this.exchangeMicrosoftCodeForTokens(
            code,
            codeVerifier,
            clientId,
            redirectUri,
            effectiveTenant,
            nonce,
            effectiveScopes,
          );
        },
      )
        .then(() => {
          resolve();
        })
        .catch((error: unknown) => {
          reject(error);
        });
    });
  }

  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  private base64UrlEncode(bytes: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private async exchangeMicrosoftCodeForTokens(
    code: string,
    codeVerifier: string,
    clientId: string,
    redirectUri: string,
    tenant: string,
    expectedNonce: string,
    scopes: string[],
  ): Promise<void> {
    const config = getConfig();
    const authBaseUrl = this.getMicrosoftAuthBaseUrl(
      tenant,
      config.microsoftB2cDomain,
    );
    const tokenUrl = `${authBaseUrl}oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const json = await this.parseResponseObject(response);

    if (!response.ok) {
      throw new Error(
        getOptionalString(json, "error_description") ??
          getOptionalString(json, "error") ??
          "Token exchange failed",
      );
    }

    const idToken = getOptionalString(json, "id_token");
    if (!idToken) {
      throw new Error("No id_token in token response");
    }

    const claims = this.decodeMicrosoftJwt(idToken);
    const payload = this.parseJwtPayload(idToken);
    if (getOptionalString(payload, "nonce") !== expectedNonce) {
      throw new Error("Nonce mismatch - token may be replayed");
    }

    const accessToken = getOptionalString(json, "access_token");
    const refreshToken = getOptionalString(json, "refresh_token");
    const expiresInSeconds = getOptionalNumber(json, "expires_in");

    if (refreshToken) {
      this.saveRefreshToken(refreshToken);
    }

    this._grantedScopes = scopes;
    this.saveValue(SCOPES_KEY, JSON.stringify(scopes));

    const user: AuthUser = {
      provider: "microsoft",
      idToken,
      accessToken: accessToken ?? undefined,
      refreshToken: refreshToken ?? undefined,
      scopes,
      expirationTime:
        typeof expiresInSeconds === "number"
          ? Date.now() + expiresInSeconds * 1000
          : undefined,
      ...claims,
    };
    this.updateUser(user);
  }

  private getMicrosoftAuthBaseUrl(tenant: string, b2cDomain?: string): string {
    if (tenant.startsWith("https://")) {
      return tenant.endsWith("/") ? tenant : `${tenant}/`;
    }

    if (b2cDomain) {
      return `https://${b2cDomain}/tfp/${tenant}/`;
    } else {
      return `https://login.microsoftonline.com/${tenant}/`;
    }
  }

  private decodeMicrosoftJwt(token: string): Partial<AuthUser> {
    try {
      const decoded = this.parseJwtPayload(token);
      return {
        email:
          getOptionalString(decoded, "preferred_username") ??
          getOptionalString(decoded, "email"),
        name: getOptionalString(decoded, "name"),
      };
    } catch (error) {
      logger.warn("Failed to decode Microsoft ID token", {
        error: String(error),
      });
      return {};
    }
  }

  private async loginApple(): Promise<void> {
    const config = getConfig();
    const clientId = config.appleWebClientId;

    if (!clientId) {
      throw new Error(
        "Apple Web Client ID not configured. Add 'APPLE_WEB_CLIENT_ID' to your .env file.",
      );
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
      script.async = true;
      script.onload = () => {
        if (!window.AppleID) {
          reject(new Error("Apple SDK not loaded"));
          return;
        }
        window.AppleID.auth.init({
          clientId,
          scope: "name email",
          redirectURI: window.location.origin,
          usePopup: true,
        });
        window.AppleID.auth
          .signIn()
          .then((response: AppleAuthResponse) => {
            const user: AuthUser = {
              provider: "apple",
              idToken: response.authorization.id_token,
              email: response.user?.email,
              name: response.user?.name
                ? `${response.user.name.firstName} ${response.user.name.lastName}`.trim()
                : undefined,
            };
            this.updateUser(user);
            resolve();
          })
          .catch((err: unknown) => {
            reject(this.mapError(err));
          });
      };
      script.onerror = () => {
        reject(new Error("Failed to load Apple SDK"));
      };
      document.head.appendChild(script);
    });
  }

  async silentRestore(): Promise<void> {
    logger.log("Attempting silent restore...");
    this.loadFromCache();
    if (this._currentUser) {
      try {
        await this.getAccessToken();
        logger.log("Silent restore successful (token refreshed)");
      } catch (e) {
        logger.warn("Silent restore failed to refresh token:", e);
      }
    }
    this.notify();
  }

  logout(): void {
    this._currentUser = undefined;
    this._grantedScopes = [];
    this.removeFromCache(CACHE_KEY);
    this.removeFromCache(SCOPES_KEY);
    this.removeFromCache(MS_REFRESH_TOKEN_KEY);
    this.notify();
  }

  private updateUser(user: AuthUser) {
    this._currentUser = user;
    const userToPersist = this.sanitizeUserForPersistence(user);
    this.saveValue(CACHE_KEY, JSON.stringify(userToPersist));
    this.notify();
  }

  setLoggingEnabled(enabled: boolean): void {
    logger.setEnabled(enabled);
  }

  setWebStorageAdapter(adapter: JSStorageAdapter | undefined): void {
    this._storageAdapter = adapter
      ? this.createWebStorageDriver(adapter)
      : undefined;
    this.loadFromCache();
    this.notify();
  }

  name = "Auth";
  dispose() {}
  equals(other: unknown) {
    return other === this;
  }
}

export const AuthModule = new AuthWeb();

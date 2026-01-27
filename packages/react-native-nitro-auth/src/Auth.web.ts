import type {
  Auth,
  AuthUser,
  AuthProvider,
  LoginOptions,
  AuthTokens,
} from "./Auth.nitro";
import type { AuthStorageAdapter } from "./AuthStorage.nitro";
import { logger } from "./utils/logger";

const CACHE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

const getConfig = () => {
  try {
    const Constants = require("expo-constants").default;
    return Constants.expoConfig?.extra || {};
  } catch {
    return {};
  }
};

class AuthWeb implements Auth {
  private _currentUser: AuthUser | undefined;
  private _grantedScopes: string[] = [];
  private _listeners: ((user: AuthUser | undefined) => void)[] = [];
  private _tokenListeners: ((tokens: AuthTokens) => void)[] = [];
  private _storageAdapter: AuthStorageAdapter | undefined;

  constructor() {
    this.loadFromCache();
  }

  private loadFromCache() {
    const cached = this._storageAdapter
      ? this._storageAdapter.load(CACHE_KEY)
      : localStorage.getItem(CACHE_KEY);

    if (cached) {
      try {
        this._currentUser = JSON.parse(cached);
      } catch {
        this.removeFromCache(CACHE_KEY);
      }
    }

    const scopes = this._storageAdapter
      ? this._storageAdapter.load(SCOPES_KEY)
      : localStorage.getItem(SCOPES_KEY);

    if (scopes) {
      try {
        this._grantedScopes = JSON.parse(scopes);
      } catch {
        this.removeFromCache(SCOPES_KEY);
      }
    }
  }

  private removeFromCache(key: string) {
    if (this._storageAdapter) {
      this._storageAdapter.remove(key);
    } else {
      localStorage.removeItem(key);
    }
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
    callback: (user: AuthUser | undefined) => void
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
    this._listeners.forEach((l) => l(this._currentUser));
  }

  async login(provider: AuthProvider, options?: LoginOptions): Promise<void> {
    const scopes = options?.scopes ?? DEFAULT_SCOPES;
    const loginHint = options?.loginHint;
    logger.log(`Starting login with ${provider}`, { scopes });
    try {
      if (provider === "google") {
        await this.loginGoogle(scopes, loginHint);
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
    if (this._currentUser.provider !== "google") {
      throw new Error("Scope management only supported for Google");
    }
    logger.log("Requesting additional scopes:", scopes);
    const newScopes = [...new Set([...this._grantedScopes, ...scopes])];
    return this.loginGoogle(newScopes).catch((e) => {
      const error = this.mapError(e);
      logger.error("Requesting scopes failed:", error.message);
      throw error;
    });
  }

  async revokeScopes(scopes: string[]): Promise<void> {
    logger.log("Revoking scopes:", scopes);
    this._grantedScopes = this._grantedScopes.filter(
      (s) => !scopes.includes(s)
    );
    if (this._storageAdapter) {
      this._storageAdapter.save(
        SCOPES_KEY,
        JSON.stringify(this._grantedScopes)
      );
    } else {
      localStorage.setItem(SCOPES_KEY, JSON.stringify(this._grantedScopes));
    }
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

  async refreshToken(): Promise<{ accessToken?: string; idToken?: string }> {
    if (!this._currentUser) {
      throw new Error("No user logged in");
    }
    if (this._currentUser.provider !== "google") {
      throw new Error("Token refresh only supported for Google");
    }
    logger.log("Refreshing tokens...");
    await this.loginGoogle(
      this._grantedScopes.length > 0 ? this._grantedScopes : DEFAULT_SCOPES
    );
    const tokens = {
      accessToken: this._currentUser.accessToken,
      idToken: this._currentUser.idToken,
    };
    this._tokenListeners.forEach((l) => l(tokens));
    return tokens;
  }

  private mapError(error: unknown): Error {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const msg = rawMessage.toLowerCase();
    let mappedMsg = rawMessage;

    if (msg.includes("cancel") || msg.includes("popup_closed")) {
      mappedMsg = "cancelled";
    } else if (msg.includes("network")) {
      mappedMsg = "network_error";
    } else if (msg.includes("client id") || msg.includes("config")) {
      mappedMsg = "configuration_error";
    }

    const authError = new Error(mappedMsg) as Error & {
      underlyingError?: string;
    };
    authError.underlyingError = rawMessage;
    return authError;
  }

  private async loginGoogle(
    scopes: string[],
    loginHint?: string
  ): Promise<void> {
    const config = getConfig();
    const clientId = config.googleWebClientId;

    if (!clientId) {
      throw new Error(
        "Google Web Client ID not configured. Add 'GOOGLE_WEB_CLIENT_ID' to your .env file."
      );
    }

    return new Promise((resolve, reject) => {
      const redirectUri = window.location.origin;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "id_token token code");
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("nonce", Math.random().toString(36).slice(2));
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
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        reject(new Error("Popup blocked. Please allow popups for this site."));
        return;
      }

      const checkInterval = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(checkInterval);
            reject(new Error("cancelled"));
            return;
          }

          const url = popup.location.href;
          if (url.startsWith(redirectUri)) {
            clearInterval(checkInterval);
            popup.close();

            const hash = new URL(url).hash.slice(1);
            const params = new URLSearchParams(hash);
            const idToken = params.get("id_token");
            const accessToken = params.get("access_token");
            const expiresIn = params.get("expires_in");
            const code = params.get("code");

            if (idToken) {
              this._grantedScopes = scopes;
              if (this._storageAdapter) {
                this._storageAdapter.save(SCOPES_KEY, JSON.stringify(scopes));
              } else {
                localStorage.setItem(SCOPES_KEY, JSON.stringify(scopes));
              }

              const user: AuthUser = {
                provider: "google",
                idToken,
                accessToken: accessToken ?? undefined,
                serverAuthCode: code ?? undefined,
                scopes,
                expirationTime: expiresIn
                  ? Date.now() + parseInt(expiresIn) * 1000
                  : undefined,
                ...this.decodeGoogleJwt(idToken),
              };
              this.updateUser(user);
              resolve();
            } else {
              reject(new Error("No id_token in response"));
            }
          }
        } catch {}
      }, 100);
    });
  }

  private decodeGoogleJwt(token: string): Partial<AuthUser> {
    try {
      const payload = token.split(".")[1];
      const decoded = JSON.parse(atob(payload));
      return {
        email: decoded.email,
        name: decoded.name,
        photo: decoded.picture,
      };
    } catch {
      return {};
    }
  }

  private async loginApple(): Promise<void> {
    const config = getConfig();
    const clientId = config.appleWebClientId;

    if (!clientId) {
      throw new Error(
        "Apple Web Client ID not configured. Add 'APPLE_WEB_CLIENT_ID' to your .env file."
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
          .then((response: any) => {
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
          .catch((err: unknown) => reject(this.mapError(err)));
      };
      script.onerror = () => reject(new Error("Failed to load Apple SDK"));
      document.head.appendChild(script);
    });
  }

  logout(): void {
    this._currentUser = undefined;
    this._grantedScopes = [];
    this.removeFromCache(CACHE_KEY);
    this.removeFromCache(SCOPES_KEY);
    this.notify();
  }

  private updateUser(user: AuthUser) {
    this._currentUser = user;
    if (this._storageAdapter) {
      this._storageAdapter.save(CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    }
    this.notify();
  }

  setLoggingEnabled(enabled: boolean): void {
    logger.setEnabled(enabled);
  }

  setStorageAdapter(adapter: AuthStorageAdapter | undefined): void {
    this._storageAdapter = adapter;
    if (adapter) {
      this.loadFromCache();
      this.notify();
    }
  }

  name = "Auth";
  dispose() {}
  equals(other: any) {
    return other === this;
  }
}

export const AuthModule = new AuthWeb();

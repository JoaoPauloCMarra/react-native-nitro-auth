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
const MS_DEFAULT_SCOPES = ["openid", "email", "profile", "User.Read"];

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
    this._listeners.forEach((l) => l(this._currentUser));
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
    if (this._storageAdapter) {
      this._storageAdapter.save(
        SCOPES_KEY,
        JSON.stringify(this._grantedScopes),
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

    if (this._currentUser.provider === "microsoft") {
      logger.log("Refreshing Microsoft tokens...");
      const refreshToken = this._storageAdapter
        ? this._storageAdapter.load("microsoft_refresh_token")
        : localStorage.getItem("nitro_auth_microsoft_refresh_token");

      if (!refreshToken) {
        throw new Error("No refresh token available");
      }

      const config = getConfig();
      const clientId = config.microsoftClientId;
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

      const json = await response.json();
      if (!response.ok) {
        throw new Error(
          json.error_description ?? json.error ?? "Token refresh failed",
        );
      }

      const idToken = json.id_token;
      const accessToken = json.access_token;
      const newRefreshToken = json.refresh_token;
      const expiresIn = json.expires_in;

      if (newRefreshToken) {
        if (this._storageAdapter) {
          this._storageAdapter.save("microsoft_refresh_token", newRefreshToken);
        } else {
          localStorage.setItem(
            "nitro_auth_microsoft_refresh_token",
            newRefreshToken,
          );
        }
      }

      const claims = this.decodeMicrosoftJwt(idToken);
      const user: AuthUser = {
        ...this._currentUser,
        idToken,
        accessToken: accessToken ?? undefined,
        expirationTime: expiresIn
          ? Date.now() + parseInt(expiresIn) * 1000
          : undefined,
        ...claims,
      };
      this.updateUser(user);

      const tokens = { accessToken, idToken };
      this._tokenListeners.forEach((l) => l(tokens));
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

    return Object.assign(new Error(mappedMsg), { underlyingError: rawMessage });
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
        `width=${width},height=${height},left=${left},top=${top}`,
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

      const checkInterval = setInterval(async () => {
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

            const urlObj = new URL(url);
            const code = urlObj.searchParams.get("code");
            const returnedState = urlObj.searchParams.get("state");
            const error = urlObj.searchParams.get("error");
            const errorDescription =
              urlObj.searchParams.get("error_description");

            if (error) {
              reject(new Error(errorDescription ?? error));
              return;
            }

            if (returnedState !== state) {
              reject(new Error("State mismatch - possible CSRF attack"));
              return;
            }

            if (!code) {
              reject(new Error("No authorization code in response"));
              return;
            }

            try {
              await this.exchangeMicrosoftCodeForTokens(
                code,
                codeVerifier,
                clientId,
                redirectUri,
                effectiveTenant,
                nonce,
                effectiveScopes,
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          }
        } catch {}
      }, 100);
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

    const json = await response.json();

    if (!response.ok) {
      throw new Error(
        json.error_description ?? json.error ?? "Token exchange failed",
      );
    }

    const idToken = json.id_token;
    if (!idToken) {
      throw new Error("No id_token in token response");
    }

    const claims = this.decodeMicrosoftJwt(idToken);
    const payload = JSON.parse(atob(idToken.split(".")[1]));
    if (payload.nonce !== expectedNonce) {
      throw new Error("Nonce mismatch - token may be replayed");
    }

    const accessToken = json.access_token;
    const refreshToken = json.refresh_token;
    const expiresIn = json.expires_in;

    if (refreshToken) {
      if (this._storageAdapter) {
        this._storageAdapter.save("microsoft_refresh_token", refreshToken);
      } else {
        localStorage.setItem(
          "nitro_auth_microsoft_refresh_token",
          refreshToken,
        );
      }
    }

    this._grantedScopes = scopes;
    if (this._storageAdapter) {
      this._storageAdapter.save(SCOPES_KEY, JSON.stringify(scopes));
    } else {
      localStorage.setItem(SCOPES_KEY, JSON.stringify(scopes));
    }

    const user: AuthUser = {
      provider: "microsoft",
      idToken,
      accessToken: accessToken ?? undefined,
      scopes,
      expirationTime: expiresIn
        ? Date.now() + parseInt(expiresIn) * 1000
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
      const payload = token.split(".")[1];
      const decoded = JSON.parse(atob(payload));
      return {
        email: decoded.preferred_username ?? decoded.email,
        name: decoded.name,
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
          .catch((err: unknown) => reject(this.mapError(err)));
      };
      script.onerror = () => reject(new Error("Failed to load Apple SDK"));
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
    this.removeFromCache("microsoft_refresh_token");
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
  equals(other: unknown) {
    return other === this;
  }
}

export const AuthModule = new AuthWeb();

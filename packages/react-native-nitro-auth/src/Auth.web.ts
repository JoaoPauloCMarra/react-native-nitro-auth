import type {
  Auth,
  AuthNonce,
  AuthCredential,
  CredentialProvider,
  AuthSessionSnapshot,
  ScopeRevocationResult,
  AuthUser,
  AuthProvider,
  LoginOptions,
  MicrosoftPrompt,
  AuthTokens,
  AuthErrorCode,
  AuthEvent,
  AuthEventType,
} from "./Auth.nitro";
import { isAuthErrorCode } from "./utils/auth-error";
import { AuthWebError, getSafeErrorCategory } from "./utils/auth-web-error";
import { logger } from "./utils/logger";
import { mapOAuthErrorCode } from "./utils/oauth-error";
import type { OAuthErrorContext } from "./utils/oauth-error";
import {
  parseExpiresInMilliseconds,
  postTokenRequest,
} from "./utils/oauth-token-client";
import {
  getOptionalString,
  isJsonObject,
  setIfDefined,
  setOrDelete,
  type JsonObject,
} from "./utils/web-json";
import {
  STORAGE_MODE_LOCAL,
  STORAGE_MODE_MEMORY,
  STORAGE_MODE_SESSION,
  WebSessionStorage,
  type WebSessionStorageConfig,
} from "./utils/web-session-storage";

const DEFAULT_SCOPES = ["openid", "email", "profile"];
const MS_DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
];
const POPUP_POLL_INTERVAL_MS = 500;
const POPUP_POLL_INTERVAL_CROSS_ORIGIN_MS = 1000;
const POPUP_TIMEOUT_MS = 120000;
const APPLE_SDK_LOAD_TIMEOUT_MS = 15000;
const APPLE_SDK_SCRIPT_ID = "nitro-auth-apple-sdk";
const MICROSOFT_TENANT_PATTERN =
  /^(common|organizations|consumers|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
const MICROSOFT_B2C_TENANT_PATH_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MICROSOFT_B2C_POLICY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MICROSOFT_B2CLOGIN_DOMAIN_SUFFIX = ".b2clogin.com";
const MICROSOFT_B2CLOGIN_TENANT_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const MICROSOFT_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const JWT_BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
let _appleSdkLoadState: AppleSdkLoadState | undefined;
let _appleSdkRetryScriptId = 0;
const _terminalAppleSdkScripts = new WeakSet<HTMLScriptElement>();

type AppleSdkLoadState = {
  promise: Promise<void>;
  script: HTMLScriptElement | undefined;
  ownsScript: boolean;
  timeoutId: number | undefined;
  onLoad: EventListener;
  onError: EventListener;
  settled: boolean;
};

type AppleAuthResponse = {
  authorization: {
    id_token: string;
    code?: string;
  };
  user?: {
    email?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
};

type AuthWebExtraConfig = WebSessionStorageConfig & {
  googleWebClientId?: string;
  microsoftClientId?: string;
  microsoftTenant?: string;
  microsoftB2cDomain?: string;
  appleWebClientId?: string;
};

type MicrosoftLoginRequest = {
  scopes: string[];
  loginHint?: string;
  tenant?: string;
  prompt?: MicrosoftPrompt;
  keepRefreshToken?: boolean;
  generation: number;
};

type MicrosoftCodeExchange = {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  tenant: string;
  expectedNonce: string;
  scopes: string[];
  keepRefreshToken: boolean;
  generation: number;
};

type AppleAuthInitConfig = Parameters<
  NonNullable<Window["AppleID"]>["auth"]["init"]
>[0];

const formatDisplayName = (
  firstName?: string,
  lastName?: string,
): string | undefined =>
  [firstName, lastName].filter(Boolean).join(" ") || undefined;

const getProviderErrorField = (error: unknown): string | undefined => {
  if (error instanceof Error || !isJsonObject(error)) return undefined;
  return typeof error.error === "string" ? error.error : undefined;
};

const INTERNAL_ERROR_MESSAGES: readonly [readonly string[], AuthErrorCode][] = [
  [["cancel", "popup_closed"], "cancelled"],
  [["timeout"], "timeout"],
  [["popup blocked"], "popup_blocked"],
  [["login is already in progress"], "operation_in_progress"],
  [["state mismatch"], "invalid_state"],
  [["nonce mismatch"], "invalid_nonce"],
  [["no id_token", "no_id_token"], "no_id_token"],
  [["invalid jwt", "json"], "parse_error"],
  [["no user logged in", "not signed in"], "not_signed_in"],
  [["network"], "network_error"],
  [["not configured", "client id"], "configuration_error"],
];

const mapInternalErrorMessage = (message: string): AuthErrorCode => {
  const normalized = message.toLowerCase();
  const match = INTERNAL_ERROR_MESSAGES.find(([needles]) =>
    needles.some((needle) => normalized.includes(needle)),
  );
  return match?.[1] ?? "unknown";
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

  const config: AuthWebExtraConfig = {};
  setIfDefined(
    config,
    "googleWebClientId",
    getOptionalString(value, "googleWebClientId"),
  );
  setIfDefined(
    config,
    "microsoftClientId",
    getOptionalString(value, "microsoftClientId"),
  );
  setIfDefined(
    config,
    "microsoftTenant",
    getOptionalString(value, "microsoftTenant"),
  );
  setIfDefined(
    config,
    "microsoftB2cDomain",
    getOptionalString(value, "microsoftB2cDomain"),
  );
  setIfDefined(
    config,
    "appleWebClientId",
    getOptionalString(value, "appleWebClientId"),
  );
  setIfDefined(config, "nitroAuthWebStorage", nitroAuthWebStorage);
  setIfDefined(
    config,
    "nitroAuthPersistTokensOnWeb",
    typeof value.nitroAuthPersistTokensOnWeb === "boolean"
      ? value.nitroAuthPersistTokensOnWeb
      : undefined,
  );
  setIfDefined(
    config,
    "nitroAuthPersistProfileOnWeb",
    typeof value.nitroAuthPersistProfileOnWeb === "boolean"
      ? value.nitroAuthPersistProfileOnWeb
      : undefined,
  );
  return config;
};

const getConfig = (): AuthWebExtraConfig => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  private readonly _config: AuthWebExtraConfig;
  private _currentUser: AuthUser | undefined;
  private _grantedScopes: string[] = [];
  private _microsoftTenant: string | undefined;
  private _listeners: ((user: AuthUser | undefined) => void)[] = [];
  private _tokenListeners: ((tokens: AuthTokens) => void)[] = [];
  private _eventListeners: ((event: AuthEvent) => void)[] = [];
  private readonly _storage: WebSessionStorage;
  private _refreshPromise: Promise<AuthTokens> | undefined;
  private _refreshReject: ((error: unknown) => void) | undefined;
  private _loginReject: ((error: unknown) => void) | undefined;
  private _credentialOnlyLogin = false;
  private _captureLoginUser: ((user: AuthUser) => void) | undefined;
  private _snapshotRevision = 0;
  private readonly _snapshotListeners = new Set<
    (snapshot: AuthSessionSnapshot) => void
  >();

  getSessionSnapshot(): AuthSessionSnapshot {
    return {
      revision: this._snapshotRevision,
      scopes: [...this._grantedScopes],
      ...(this._currentUser
        ? {
            user: {
              ...this._currentUser,
              ...(this._currentUser.scopes
                ? { scopes: [...this._currentUser.scopes] }
                : {}),
            },
          }
        : {}),
    };
  }

  onSessionChanged(
    callback: (snapshot: AuthSessionSnapshot) => void,
  ): () => void {
    this._snapshotListeners.add(callback);
    return () => {
      this._snapshotListeners.delete(callback);
    };
  }

  private assertNoCredential(): void {
    if (this._credentialOnlyLogin)
      throw new AuthWebError("operation_in_progress");
  }
  private _loginInFlight: boolean = false;
  private readonly _popupCancels = new Set<() => void>();
  private _sessionGeneration = 0;
  private _disposed = false;

  constructor() {
    this._config = getConfig();
    this._storage = new WebSessionStorage(this._config);
    this.loadFromCache();
  }

  private loadFromCache(): void {
    const restored = this._storage.restore();
    if (restored.user) this._currentUser = restored.user;
    if (restored.scopes) this._grantedScopes = restored.scopes;
  }

  get currentUser(): AuthUser | undefined {
    return this._currentUser;
  }

  get grantedScopes(): string[] {
    return [...this._grantedScopes];
  }

  get hasPlayServices(): boolean {
    return true;
  }

  onAuthStateChanged(
    callback: (user: AuthUser | undefined) => void,
  ): () => void {
    this._listeners.push(callback);
    try {
      callback(this._currentUser);
    } catch {
      logger.warn("Auth state listener failed");
    }
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

  onAuthEvent(callback: (event: AuthEvent) => void): () => void {
    this._eventListeners.push(callback);
    return () => {
      this._eventListeners = this._eventListeners.filter((l) => l !== callback);
    };
  }

  private emitEvent(
    type: AuthEventType,
    provider?: AuthProvider,
    errorCode?: AuthErrorCode,
  ): void {
    const event: AuthEvent = { type };
    setIfDefined(event, "provider", provider);
    setIfDefined(event, "errorCode", errorCode);
    for (const listener of [...this._eventListeners]) {
      try {
        listener(event);
      } catch {
        logger.warn("Auth event listener failed");
      }
    }
  }

  private notify() {
    this._snapshotRevision++;
    const snapshot = this.getSessionSnapshot();
    for (const listener of [...this._snapshotListeners]) {
      try {
        listener(snapshot);
      } catch {
        logger.warn("Auth snapshot listener failed");
      }
    }
    for (const listener of [...this._listeners]) {
      try {
        listener(this._currentUser);
      } catch {
        logger.warn("Auth state listener failed");
      }
    }
    this.emitEvent("session_changed", this._currentUser?.provider);
  }

  private notifyTokenListeners(tokens: AuthTokens): void {
    for (const listener of [...this._tokenListeners]) {
      try {
        listener(tokens);
      } catch {
        logger.warn("Auth token listener failed");
      }
    }
  }

  private async runLoginOperation(
    operation: () => Promise<void>,
    onStart?: () => void,
    errorContext: OAuthErrorContext = "authorize",
  ): Promise<AuthUser | undefined> {
    if (this._disposed) {
      throw new AuthWebError("cancelled", "Auth module disposed");
    }
    if (this._loginInFlight) {
      throw new AuthWebError(
        "operation_in_progress",
        "Another login is already in progress",
      );
    }

    this._loginInFlight = true;
    onStart?.();
    let completedUser: AuthUser | undefined;
    const capture = (user: AuthUser) => {
      completedUser = {
        ...user,
        ...(user.scopes ? { scopes: [...user.scopes] } : {}),
      };
    };
    this._captureLoginUser = capture;
    let rejectLogin: ((error: unknown) => void) | undefined;
    const operationPromise = Promise.resolve().then(operation);
    const cancellable = new Promise<void>((resolve, reject) => {
      rejectLogin = reject;
      void operationPromise.then(resolve).catch(reject);
    });
    this._loginReject = rejectLogin;
    try {
      await cancellable;
      return completedUser;
    } catch (e: unknown) {
      throw this.mapError(e, errorContext);
    } finally {
      if (this._captureLoginUser === capture)
        this._captureLoginUser = undefined;
      if (this._loginReject === rejectLogin) {
        this._loginInFlight = false;
        this._loginReject = undefined;
      }
    }
  }

  private beginSessionChange(): number {
    const generation = ++this._sessionGeneration;
    const rejectRefresh = this._refreshReject;
    this._refreshPromise = undefined;
    this._refreshReject = undefined;
    rejectRefresh?.(new AuthWebError("cancelled", "Auth session is changing"));
    return generation;
  }

  /** Cancels the active login so logout/dispose settle pending work. */
  private cancelActiveLogin(): void {
    for (const cancelPopup of [...this._popupCancels]) cancelPopup();
    this._loginReject?.(
      new AuthWebError("cancelled", "Auth operation was cancelled"),
    );
  }

  private assertActiveGeneration(generation: number): void {
    if (this._disposed || this._sessionGeneration !== generation) {
      throw new AuthWebError("cancelled", "Auth operation was cancelled");
    }
  }

  private assertSecureContext(): void {
    if (
      typeof crypto === "undefined" ||
      typeof crypto.getRandomValues !== "function" ||
      typeof crypto.randomUUID !== "function" ||
      !crypto.subtle
    ) {
      throw new AuthWebError(
        "configuration_error",
        "Web login requires a secure context (HTTPS or localhost)",
      );
    }
  }

  async createNonce(): Promise<AuthNonce> {
    this.assertSecureContext();
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const raw = this.base64UrlEncode(randomBytes);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw),
    );
    const hashed = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return { raw, hashed };
  }

  async getCredential(
    provider: CredentialProvider,
    options?: LoginOptions,
  ): Promise<AuthCredential> {
    if (provider !== "google" && provider !== "apple")
      throw new AuthWebError("unsupported_provider");
    this.assertNoCredential();
    if (this._loginInFlight || this._refreshPromise)
      throw new AuthWebError("operation_in_progress");
    if (this._currentUser) throw new AuthWebError("invalid_state");
    const generation = this._sessionGeneration;
    this._credentialOnlyLogin = true;
    try {
      const nonce = await this.createNonce();
      this.assertActiveGeneration(generation);
      if (!nonce.raw || !/^[a-f0-9]{64}$/.test(nonce.hashed))
        throw new AuthWebError("invalid_nonce");
      const loginOptions: LoginOptions = {
        ...options,
        nonce: nonce.hashed,
        scopes:
          options?.scopes ??
          (provider === "google" ? DEFAULT_SCOPES : ["email", "fullName"]),
      };
      delete loginOptions.useLegacyGoogleSignIn;
      const user = await this.runLoginOperation(() =>
        provider === "google"
          ? this.loginGoogle(
              loginOptions.scopes ?? [],
              loginOptions,
              generation,
            )
          : this.loginApple(loginOptions, generation),
      );
      this.assertActiveGeneration(generation);
      if (user?.provider !== provider) throw new AuthWebError("invalid_state");
      if (!user.idToken) throw new AuthWebError("no_id_token");
      return { provider, idToken: user.idToken, nonce: nonce.raw, user };
    } finally {
      this._credentialOnlyLogin = false;
    }
  }

  async login(provider: AuthProvider, options?: LoginOptions): Promise<void> {
    await this.loginAndGetUser(provider, options);
  }

  async loginAndGetUser(
    provider: AuthProvider,
    options?: LoginOptions,
  ): Promise<AuthUser> {
    this.assertNoCredential();
    const loginHint = options?.loginHint;
    let generation = this._sessionGeneration;
    logger.log(`Starting login with ${provider}`, { scopes: options?.scopes });
    try {
      const user = await this.runLoginOperation(
        async () => {
          // Only emit after the in-flight guard: a rejected duplicate login
          // must not claim it "started".
          this.emitEvent("login_started", provider);
          if (provider === "google") {
            const scopes = options?.scopes ?? DEFAULT_SCOPES;
            await this.loginGoogle(scopes, options, generation);
            return;
          }

          if (provider === "microsoft") {
            const scopes = options?.scopes ?? MS_DEFAULT_SCOPES;
            await this.loginMicrosoft({
              scopes,
              ...(loginHint !== undefined ? { loginHint } : {}),
              ...(options?.tenant !== undefined
                ? { tenant: options.tenant }
                : {}),
              ...(options?.prompt !== undefined
                ? { prompt: options.prompt }
                : {}),
              generation,
            });
            return;
          }

          if (provider === "apple") {
            await this.loginApple(options, generation);
            return;
          }

          throw new AuthWebError(
            "unsupported_provider",
            `Unsupported auth provider: ${provider}`,
          );
        },
        () => {
          generation = this.beginSessionChange();
        },
      );
      this.emitEvent("login_succeeded", provider);
      logger.log(`Login successful with ${provider}`);
      if (!user) throw new AuthWebError("not_signed_in");
      return user;
    } catch (e: unknown) {
      const error = this.mapError(e);
      this.emitEvent("login_failed", provider, error.code);
      logger.error(`Login failed for ${provider}:`, error.message);
      throw error;
    }
  }

  async requestScopes(scopes: string[]): Promise<void> {
    this.assertNoCredential();
    if (!this._currentUser) {
      throw new AuthWebError("not_signed_in", "No user logged in");
    }
    const provider = this._currentUser.provider;
    if (provider !== "google" && provider !== "microsoft") {
      throw new AuthWebError(
        "unsupported_provider",
        "Scope management only supported for Google and Microsoft",
      );
    }
    logger.log("Requesting additional scopes:", scopes);
    const newScopes = [...new Set([...this._grantedScopes, ...scopes])];
    try {
      let generation = this._sessionGeneration;
      await this.runLoginOperation(
        async () => {
          if (provider === "google") {
            const email = this._currentUser?.email;
            await this.loginGoogle(
              newScopes,
              email !== undefined ? { loginHint: email } : undefined,
              generation,
              this._currentUser?.userId,
            );
            return;
          }

          await this.loginMicrosoft({
            scopes: newScopes,
            ...(this._microsoftTenant !== undefined
              ? { tenant: this._microsoftTenant }
              : {}),
            keepRefreshToken: true,
            generation,
          });
        },
        () => {
          generation = this.beginSessionChange();
        },
      );
    } catch (e) {
      const error = this.mapError(e);
      logger.error("Requesting scopes failed:", error.message);
      throw error;
    }
  }

  async revokeScopes(scopes: string[]): Promise<void> {
    await this.revokeScopesWithResult(scopes);
  }

  async revokeScopesWithResult(
    scopes: string[],
  ): Promise<ScopeRevocationResult> {
    this.assertNoCredential();
    const revokedScopes = this._grantedScopes.filter((scope) =>
      scopes.includes(scope),
    );
    logger.log("Revoking scopes:", scopes);
    const scopesToRevoke = new Set(scopes);
    this._grantedScopes = this._grantedScopes.filter(
      (scope) => !scopesToRevoke.has(scope),
    );
    this._storage.saveScopes(this._grantedScopes);
    if (this._currentUser) {
      this._currentUser.scopes = [...this._grantedScopes];
      this.updateUser(this._currentUser);
    }
    return { revokedAtProvider: false, revokedScopes };
  }

  async revokeAccess(): Promise<void> {
    this.assertNoCredential();
    const user = this._currentUser;
    if (!user) {
      throw new AuthWebError("not_signed_in", "No user logged in");
    }
    if (user.provider !== "google") {
      throw new AuthWebError(
        "unsupported_provider",
        `Client-side access revocation is unavailable for ${user.provider}`,
      );
    }
    if (!user.accessToken) {
      throw new AuthWebError(
        "token_error",
        "Google access token is required for revocation",
      );
    }

    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: user.accessToken }).toString(),
      });
    } catch (error) {
      throw new AuthWebError("network_error", String(error));
    }

    if (!response.ok) {
      throw new AuthWebError(
        "token_error",
        `Google access revocation failed with HTTP ${response.status}`,
      );
    }

    this.logout();
  }

  async getAccessToken(): Promise<string | undefined> {
    this.assertNoCredential();
    if (this._currentUser && this.isAccessTokenExpiring(this._currentUser)) {
      logger.log("Token about to expire, refreshing...");
      await this.refreshToken();
    }
    return this._currentUser?.accessToken;
  }

  async refreshToken(): Promise<AuthTokens> {
    this.assertNoCredential();
    if (this._refreshPromise) {
      return this._refreshPromise;
    }
    if (this._loginInFlight) {
      throw new AuthWebError("operation_in_progress");
    }

    const generation = this._sessionGeneration;
    let rejectRefresh: ((error: unknown) => void) | undefined;
    const refreshPromise = new Promise<AuthTokens>((resolve, reject) => {
      rejectRefresh = reject;
      void this.performRefreshToken(generation)
        .then(resolve)
        .catch((e: unknown) => {
          reject(this.mapError(e, "refresh"));
        });
    });
    this._refreshPromise = refreshPromise;
    this._refreshReject = rejectRefresh;
    try {
      return await refreshPromise;
    } catch (e: unknown) {
      const error = this.mapError(e, "refresh");
      if (this._sessionGeneration === generation) {
        this.emitEvent(
          "refresh_failed",
          this._currentUser?.provider,
          error.code,
        );
      }
      throw error;
    } finally {
      if (this._refreshPromise === refreshPromise) {
        this._refreshPromise = undefined;
        this._refreshReject = undefined;
      }
    }
  }

  private async performRefreshToken(generation: number): Promise<AuthTokens> {
    if (!this._currentUser) {
      throw new AuthWebError("not_signed_in", "No user logged in");
    }

    if (this._currentUser.provider === "microsoft") {
      logger.log("Refreshing Microsoft tokens...");
      const refreshToken = this._storage.loadRefreshToken();

      if (!refreshToken) {
        throw new AuthWebError("refresh_failed", "No refresh token available");
      }

      const clientId = this._config.microsoftClientId;
      if (!clientId) {
        throw new AuthWebError(
          "configuration_error",
          "Microsoft Client ID not configured. Add 'microsoftClientId' to expo.extra in your app.config.js",
        );
      }
      const tenant =
        this._microsoftTenant ?? this._config.microsoftTenant ?? "common";
      const b2cDomain = this._config.microsoftB2cDomain;

      const authBaseUrl = this.getMicrosoftAuthBaseUrl(tenant, b2cDomain);
      const tokenUrl = `${authBaseUrl}oauth2/v2.0/token`;
      const parsed = await postTokenRequest(
        { tokenUrl, clientId, refreshToken },
        "refresh",
      );
      this.assertActiveGeneration(generation);
      if (!parsed.ok) {
        throw new AuthWebError(
          parsed.errorCode,
          parsed.underlyingMessage ?? "Token refresh failed",
        );
      }
      const idToken = parsed.tokens.idToken;
      if (!idToken) {
        throw new AuthWebError(
          "no_id_token",
          "No id_token in token refresh response",
        );
      }
      const accessToken = parsed.tokens.accessToken;
      const newRefreshToken = parsed.tokens.refreshToken;
      const expirationTime = parsed.tokens.expirationTime;

      if (newRefreshToken) {
        this._storage.saveRefreshToken(newRefreshToken);
      }

      const currentUser = this._currentUser;
      const claims = this.decodeMicrosoftJwt(idToken);
      const user: AuthUser = {
        ...currentUser,
        ...claims,
      };
      setOrDelete(user, "idToken", idToken);
      setOrDelete(user, "accessToken", accessToken);
      setOrDelete(
        user,
        "refreshToken",
        newRefreshToken ?? currentUser.refreshToken,
      );
      setOrDelete(user, "expirationTime", expirationTime);
      this.updateUser(user);

      const tokens: AuthTokens = {};
      setIfDefined(tokens, "accessToken", accessToken);
      setIfDefined(tokens, "idToken", idToken);
      setIfDefined(tokens, "refreshToken", newRefreshToken);
      setIfDefined(tokens, "expirationTime", expirationTime);
      this.notifyTokenListeners(tokens);
      this.emitEvent("tokens_refreshed", "microsoft");
      return tokens;
    }

    if (this._currentUser.provider !== "google") {
      throw new AuthWebError(
        "unsupported_provider",
        `Token refresh not supported for ${this._currentUser.provider}`,
      );
    }

    logger.log("Refreshing tokens...");
    await this.runLoginOperation(
      () =>
        this.loginGoogle(
          this._grantedScopes.length > 0 ? this._grantedScopes : DEFAULT_SCOPES,
          this._currentUser?.email !== undefined
            ? { loginHint: this._currentUser.email }
            : undefined,
          generation,
          this._currentUser?.userId,
        ),
      undefined,
      "refresh",
    );
    this.assertActiveGeneration(generation);
    const tokens: AuthTokens = {};
    setIfDefined(tokens, "accessToken", this._currentUser.accessToken);
    setIfDefined(tokens, "idToken", this._currentUser.idToken);
    setIfDefined(tokens, "refreshToken", this._currentUser.refreshToken);
    setIfDefined(tokens, "expirationTime", this._currentUser.expirationTime);
    this.notifyTokenListeners(tokens);
    this.emitEvent("tokens_refreshed", "google");
    return tokens;
  }

  private mapError(
    error: unknown,
    context: OAuthErrorContext = "authorize",
  ): AuthWebError {
    if (error instanceof AuthWebError) {
      return error;
    }

    const providerError = getProviderErrorField(error);
    const rawMessage =
      providerError ?? (error instanceof Error ? error.message : String(error));
    if (isAuthErrorCode(rawMessage)) {
      return new AuthWebError(rawMessage, rawMessage);
    }
    const providerCode = mapOAuthErrorCode(rawMessage, context);
    if (providerCode !== "unknown" || providerError !== undefined) {
      return new AuthWebError(providerCode, rawMessage);
    }
    return new AuthWebError(mapInternalErrorMessage(rawMessage), rawMessage);
  }

  private parseJwtPayload(token: string): JsonObject {
    const parts = token.split(".");
    const payload = parts[1];
    if (
      parts.length < 2 ||
      !payload ||
      payload.length % 4 === 1 ||
      !JWT_BASE64_URL_RE.test(payload)
    ) {
      throw new AuthWebError("parse_error", "Invalid JWT payload");
    }

    try {
      const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padding = "=".repeat((4 - (normalizedPayload.length % 4)) % 4);
      const binary = atob(`${normalizedPayload}${padding}`);
      const decodedText =
        typeof TextDecoder === "function"
          ? new TextDecoder().decode(
              Uint8Array.from(binary, (char) => char.charCodeAt(0)),
            )
          : decodeURIComponent(
              Array.from(
                binary,
                (char) =>
                  `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
              ).join(""),
            );
      const decoded: unknown = JSON.parse(decodedText);
      if (!isJsonObject(decoded)) {
        throw new Error("Expected JWT payload to be an object");
      }
      return decoded;
    } catch (error) {
      if (error instanceof AuthWebError) {
        throw error;
      }
      throw new AuthWebError("parse_error", String(error));
    }
  }

  /**
   * Accepts only the exact registered redirect target. The provider redirects
   * to the page root (`redirectUri` = origin), optionally carrying a hash or
   * query section; any other path is rejected instead of being parsed.
   */
  private isExactRedirectTarget(url: string, origin: string): boolean {
    if (url === origin || url === `${origin}/`) {
      return true;
    }
    return (
      url.startsWith(`${origin}#`) ||
      url.startsWith(`${origin}/#`) ||
      url.startsWith(`${origin}?`) ||
      url.startsWith(`${origin}/?`)
    );
  }

  private waitForPopupRedirect(
    popup: Window,
    redirectUri: string,
    provider: "Google" | "Microsoft",
    onRedirect: (url: string) => Promise<void> | void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let crossOrigin = false;
      let pollId: number | undefined;

      const schedulePoll = (delay: number) => {
        pollId = window.setTimeout(poll, delay);
      };

      const cleanup = (timeoutId: number, shouldClosePopup: boolean) => {
        this._popupCancels.delete(cancel);
        window.clearTimeout(timeoutId);
        if (pollId !== undefined) window.clearTimeout(pollId);
        if (shouldClosePopup && !popup.closed) {
          popup.close();
        }
      };

      const cancel = () => {
        cleanup(timeoutId, true);
        reject(new AuthWebError("cancelled"));
      };

      const timeoutId = window.setTimeout(() => {
        cleanup(timeoutId, true);
        reject(
          new AuthWebError("timeout", `${provider.toLowerCase()}_auth_timeout`),
        );
      }, POPUP_TIMEOUT_MS);

      const poll = () => {
        pollId = undefined;
        if (popup.closed) {
          cleanup(timeoutId, false);
          reject(new AuthWebError("cancelled"));
          return;
        }

        let url: string;
        try {
          url = popup.location.href;
        } catch (error) {
          // Cross-origin: the popup is on the provider domain. Poll slowly
          // there; same-origin reads are only possible before the popup
          // navigates away and after it returns to the redirect target.
          if (!crossOrigin) {
            crossOrigin = true;
            logger.debug(`Waiting for ${provider} auth redirect`, {
              error: String(error),
            });
          }
          schedulePoll(POPUP_POLL_INTERVAL_CROSS_ORIGIN_MS);
          return;
        }
        crossOrigin = false;

        if (!this.isExactRedirectTarget(url, redirectUri)) {
          schedulePoll(POPUP_POLL_INTERVAL_MS);
          return;
        }

        cleanup(timeoutId, true);
        void Promise.resolve()
          .then(() => onRedirect(url))
          .then(() => {
            resolve();
          })
          .catch((error: unknown) => {
            reject(error);
          });
      };

      this._popupCancels.add(cancel);
      schedulePoll(POPUP_POLL_INTERVAL_MS);
    });
  }

  private openAuthPopup(authUrl: URL, name: string): Window {
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl.toString(),
      name,
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      throw new AuthWebError(
        "popup_blocked",
        "Popup blocked. Please allow popups for this site.",
      );
    }
    return popup;
  }

  private assertAuthorizeResponse(
    params: URLSearchParams,
    expectedState: string,
  ): void {
    if (params.get("state") !== expectedState) {
      throw new AuthWebError(
        "invalid_state",
        "State mismatch - possible CSRF attack",
      );
    }

    const error = params.get("error");
    if (error) {
      throw new AuthWebError(
        mapOAuthErrorCode(error, "authorize"),
        params.get("error_description") ?? error,
      );
    }
  }

  private async loginGoogle(
    scopes: string[],
    options: LoginOptions | undefined,
    generation: number,
    expectedUserId?: string,
  ): Promise<void> {
    const clientId = this._config.googleWebClientId;

    if (!clientId) {
      throw new AuthWebError(
        "configuration_error",
        "Google Web Client ID not configured. Add 'GOOGLE_WEB_CLIENT_ID' to your .env file.",
      );
    }

    this.assertSecureContext();
    const nonce = options?.nonce ?? crypto.randomUUID();
    const state = crypto.randomUUID();
    const redirectUri = window.location.origin;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "id_token token code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("nonce", nonce);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set(
      "prompt",
      options?.forceAccountPicker ? "select_account consent" : "consent",
    );

    if (options?.loginHint) {
      authUrl.searchParams.set("login_hint", options.loginHint);
    }
    if (options?.hostedDomain) {
      authUrl.searchParams.set("hd", options.hostedDomain);
    }
    if (options?.openIDRealm) {
      authUrl.searchParams.set("openid.realm", options.openIDRealm);
    }

    const popup = this.openAuthPopup(authUrl, "google-auth");

    await this.waitForPopupRedirect(popup, redirectUri, "Google", (url) => {
      const params = new URLSearchParams(new URL(url).hash.slice(1));
      this.assertAuthorizeResponse(params, state);

      const idToken = params.get("id_token");
      const accessToken = params.get("access_token");
      const expiresIn = params.get("expires_in");
      const code = params.get("code");

      if (!idToken) {
        throw new AuthWebError("no_id_token", "No id_token in response");
      }

      const decoded = this.parseJwtPayload(idToken);
      if (decoded["nonce"] !== nonce) {
        throw new AuthWebError(
          "invalid_nonce",
          "Nonce mismatch - possible replay attack",
        );
      }

      this.assertActiveGeneration(generation);

      if (
        expectedUserId !== undefined &&
        getOptionalString(decoded, "sub") !== expectedUserId
      ) {
        throw new AuthWebError(
          "invalid_state",
          "Signed-in account changed during re-authentication",
        );
      }

      if (!this._credentialOnlyLogin) {
        this._grantedScopes = [...scopes];
        this._storage.saveScopes(scopes);
      }

      const user: AuthUser = {
        provider: "google",
        idToken,
        scopes: [...scopes],
        ...this.decodeGoogleJwt(idToken),
      };
      setIfDefined(user, "accessToken", accessToken ?? undefined);
      setIfDefined(user, "serverAuthCode", code ?? undefined);
      setIfDefined(user, "userId", getOptionalString(decoded, "sub"));
      setIfDefined(user, "hostedDomain", getOptionalString(decoded, "hd"));
      setIfDefined(
        user,
        "expirationTime",
        parseExpiresInMilliseconds(expiresIn),
      );
      this.updateUser(user);
    });
  }

  private decodeGoogleJwt(token: string): Partial<AuthUser> {
    try {
      const decoded = this.parseJwtPayload(token);
      const user: Partial<AuthUser> = {};
      setIfDefined(user, "email", getOptionalString(decoded, "email"));
      setIfDefined(user, "name", getOptionalString(decoded, "name"));
      setIfDefined(user, "firstName", getOptionalString(decoded, "given_name"));
      setIfDefined(user, "lastName", getOptionalString(decoded, "family_name"));
      setIfDefined(user, "photo", getOptionalString(decoded, "picture"));
      setIfDefined(user, "userId", getOptionalString(decoded, "sub"));
      setIfDefined(user, "hostedDomain", getOptionalString(decoded, "hd"));
      return user;
    } catch (error) {
      logger.warn("Failed to decode Google ID token", { error: String(error) });
      return {};
    }
  }

  private async loginMicrosoft({
    scopes,
    loginHint,
    tenant,
    prompt,
    keepRefreshToken = false,
    generation,
  }: MicrosoftLoginRequest): Promise<void> {
    const clientId = this._config.microsoftClientId;

    if (!clientId) {
      throw new AuthWebError(
        "configuration_error",
        "Microsoft Client ID not configured. Add 'microsoftClientId' to expo.extra in your app.config.js",
      );
    }

    const effectiveTenant = tenant ?? this._config.microsoftTenant ?? "common";
    const b2cDomain = this._config.microsoftB2cDomain;
    const authBaseUrl = this.getMicrosoftAuthBaseUrl(
      effectiveTenant,
      b2cDomain,
    );

    const effectiveScopes = scopes.length ? scopes : MS_DEFAULT_SCOPES;

    this.assertSecureContext();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();

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

    const popup = this.openAuthPopup(authUrl, "microsoft-auth");

    await this.waitForPopupRedirect(
      popup,
      redirectUri,
      "Microsoft",
      async (url) => {
        const { searchParams } = new URL(url);
        this.assertAuthorizeResponse(searchParams, state);

        const code = searchParams.get("code");
        if (!code) {
          throw new AuthWebError(
            "token_error",
            "No authorization code in response",
          );
        }

        await this.exchangeMicrosoftCodeForTokens({
          code,
          codeVerifier,
          clientId,
          redirectUri,
          tenant: effectiveTenant,
          expectedNonce: nonce,
          scopes: effectiveScopes,
          keepRefreshToken,
          generation,
        });
      },
    );
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

  private async exchangeMicrosoftCodeForTokens({
    code,
    codeVerifier,
    clientId,
    redirectUri,
    tenant,
    expectedNonce,
    scopes,
    keepRefreshToken,
    generation,
  }: MicrosoftCodeExchange): Promise<void> {
    const authBaseUrl = this.getMicrosoftAuthBaseUrl(
      tenant,
      this._config.microsoftB2cDomain,
    );
    const tokenUrl = `${authBaseUrl}oauth2/v2.0/token`;

    const parsed = await postTokenRequest(
      { tokenUrl, clientId, code, redirectUri, codeVerifier },
      "token",
    );
    this.assertActiveGeneration(generation);
    if (!parsed.ok) {
      throw new AuthWebError(
        parsed.errorCode,
        parsed.underlyingMessage ?? "Token exchange failed",
      );
    }

    const idToken = parsed.tokens.idToken;
    if (!idToken) {
      throw new AuthWebError("no_id_token", "No id_token in token response");
    }

    const claims = this.decodeMicrosoftJwt(idToken);
    const payload = this.parseJwtPayload(idToken);
    if (getOptionalString(payload, "nonce") !== expectedNonce) {
      throw new AuthWebError(
        "invalid_nonce",
        "Nonce mismatch - token may be replayed",
      );
    }

    const accessToken = parsed.tokens.accessToken;
    const refreshToken = parsed.tokens.refreshToken;

    if (refreshToken) {
      this._storage.saveRefreshToken(refreshToken);
    } else if (!keepRefreshToken) {
      this._storage.clearRefreshToken();
    }

    this._grantedScopes = [...scopes];
    this._microsoftTenant = tenant;
    this._storage.saveScopes(scopes);

    const user: AuthUser = {
      provider: "microsoft",
      idToken,
      scopes: [...scopes],
      ...claims,
    };
    setIfDefined(user, "accessToken", accessToken);
    setIfDefined(user, "refreshToken", refreshToken);
    setIfDefined(user, "expirationTime", parsed.tokens.expirationTime);
    this.updateUser(user);
  }

  private getMicrosoftAuthBaseUrl(tenant: string, b2cDomain?: string): string {
    const trimmedTenant = tenant.trim();

    const trimmedDomain = b2cDomain?.trim().toLowerCase();
    if (trimmedDomain) {
      if (!MICROSOFT_DOMAIN_PATTERN.test(trimmedDomain)) {
        throw new AuthWebError(
          "configuration_error",
          "Microsoft B2C domain must be a hostname.",
        );
      }
      const b2cTenantPath = this.getMicrosoftB2cTenantPath(
        trimmedTenant,
        trimmedDomain,
      );
      return `https://${trimmedDomain}/${b2cTenantPath}/`;
    }

    if (!MICROSOFT_TENANT_PATTERN.test(trimmedTenant)) {
      throw new AuthWebError(
        "configuration_error",
        "Microsoft tenant must be common, organizations, consumers, a tenant ID, or tenant domain.",
      );
    }

    return `https://login.microsoftonline.com/${trimmedTenant}/`;
  }

  private getMicrosoftB2cTenantPath(tenant: string, domain: string): string {
    if (MICROSOFT_B2C_TENANT_PATH_PATTERN.test(tenant)) {
      return tenant;
    }

    if (!MICROSOFT_B2C_POLICY_PATTERN.test(tenant)) {
      throw new AuthWebError(
        "configuration_error",
        "Microsoft B2C tenant must be a policy or tenant/policy path.",
      );
    }

    const tenantName = this.getMicrosoftB2cTenantName(domain);
    if (tenantName === undefined) {
      throw new AuthWebError(
        "configuration_error",
        "Microsoft B2C custom domains require microsoftTenant as a tenant/policy path.",
      );
    }

    return `${tenantName}.onmicrosoft.com/${tenant}`;
  }

  private getMicrosoftB2cTenantName(domain: string): string | undefined {
    if (!domain.endsWith(MICROSOFT_B2CLOGIN_DOMAIN_SUFFIX)) {
      return undefined;
    }

    const tenantName = domain.slice(
      0,
      -MICROSOFT_B2CLOGIN_DOMAIN_SUFFIX.length,
    );
    return MICROSOFT_B2CLOGIN_TENANT_NAME_PATTERN.test(tenantName)
      ? tenantName
      : undefined;
  }

  private decodeMicrosoftJwt(token: string): Partial<AuthUser> {
    try {
      const decoded = this.parseJwtPayload(token);
      const user: Partial<AuthUser> = {};
      setIfDefined(
        user,
        "email",
        getOptionalString(decoded, "preferred_username") ??
          getOptionalString(decoded, "email"),
      );
      setIfDefined(user, "name", getOptionalString(decoded, "name"));
      return user;
    } catch (error) {
      logger.warn("Failed to decode Microsoft ID token", {
        error: String(error),
      });
      return {};
    }
  }

  private async ensureAppleSdkLoaded(): Promise<void> {
    if (window.AppleID) {
      return;
    }

    if (_appleSdkLoadState) {
      return _appleSdkLoadState.promise;
    }

    let resolveLoad!: () => void;
    let rejectLoad!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    const state: AppleSdkLoadState = {
      promise,
      script: undefined,
      ownsScript: false,
      timeoutId: undefined,
      onLoad: () => undefined,
      onError: () => undefined,
      settled: false,
    };
    _appleSdkLoadState = state;

    const settle = (error?: Error): void => {
      if (state.settled || _appleSdkLoadState !== state) {
        return;
      }
      state.settled = true;
      if (state.timeoutId !== undefined) {
        window.clearTimeout(state.timeoutId);
      }

      const script = state.script;
      if (script) {
        script.removeEventListener("load", state.onLoad);
        script.removeEventListener("error", state.onError);
        _terminalAppleSdkScripts.add(script);
        if (error && state.ownsScript && script.parentNode) {
          try {
            script.parentNode.removeChild(script);
          } catch (cleanupError) {
            logger.debug("Failed to remove a failed Apple SDK script", {
              error: getSafeErrorCategory(cleanupError),
            });
          }
        }
      }

      _appleSdkLoadState = undefined;
      if (error) {
        rejectLoad(error);
      } else {
        resolveLoad();
      }
    };

    state.onLoad = () => {
      if (window.AppleID) {
        settle();
      } else {
        settle(new AuthWebError("network_error", "Failed to load Apple SDK"));
      }
    };
    state.onError = () => {
      settle(new AuthWebError("network_error", "Failed to load Apple SDK"));
    };

    try {
      const existingElement = document.getElementById(APPLE_SDK_SCRIPT_ID);
      const existingScript =
        existingElement instanceof HTMLScriptElement ? existingElement : null;
      const canReuseExistingScript =
        existingScript !== null &&
        !_terminalAppleSdkScripts.has(existingScript);
      const script = canReuseExistingScript
        ? existingScript
        : document.createElement("script");

      state.script = script;
      state.ownsScript = !canReuseExistingScript;
      if (state.ownsScript) {
        script.id = existingElement
          ? `${APPLE_SDK_SCRIPT_ID}-${++_appleSdkRetryScriptId}`
          : APPLE_SDK_SCRIPT_ID;
        script.src =
          "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
        script.async = true;
      }

      script.addEventListener("load", state.onLoad);
      script.addEventListener("error", state.onError);
      state.timeoutId = window.setTimeout(() => {
        settle(new AuthWebError("timeout", "Apple SDK script load timed out"));
      }, APPLE_SDK_LOAD_TIMEOUT_MS);
      if (state.ownsScript) {
        document.head.appendChild(script);
      }
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }

    return promise;
  }

  private async loginApple(
    options: LoginOptions | undefined,
    generation: number,
  ): Promise<void> {
    const clientId = this._config.appleWebClientId;

    if (!clientId) {
      throw new AuthWebError(
        "configuration_error",
        "Apple Web Client ID not configured. Add 'APPLE_WEB_CLIENT_ID' to your .env file.",
      );
    }

    await this.ensureAppleSdkLoaded();
    this.assertActiveGeneration(generation);
    if (!window.AppleID) {
      throw new AuthWebError("network_error", "Apple SDK not loaded");
    }

    this.assertSecureContext();
    const nonce = options?.nonce ?? crypto.randomUUID();
    const appleAuthConfig: AppleAuthInitConfig = {
      clientId,
      scope: (options?.scopes ?? ["name", "email"])
        .map((scope) => (scope === "fullName" ? "name" : scope))
        .join(" "),
      redirectURI: window.location.origin,
      usePopup: true,
    };
    setIfDefined(appleAuthConfig, "nonce", nonce);
    window.AppleID.auth.init(appleAuthConfig);

    try {
      const response: AppleAuthResponse = await window.AppleID.auth.signIn();
      this.assertActiveGeneration(generation);
      const idToken = response.authorization.id_token;
      const idTokenClaims = this.parseJwtPayload(idToken);
      if (getOptionalString(idTokenClaims, "nonce") !== nonce) {
        throw new AuthWebError(
          "invalid_nonce",
          "Nonce mismatch - identity token may be replayed",
        );
      }
      const user: AuthUser = {
        provider: "apple",
        idToken,
      };
      setIfDefined(user, "authorizationCode", response.authorization.code);
      setIfDefined(user, "email", response.user?.email);
      setIfDefined(user, "firstName", response.user?.name?.firstName);
      setIfDefined(user, "lastName", response.user?.name?.lastName);
      setIfDefined(
        user,
        "name",
        formatDisplayName(
          response.user?.name?.firstName,
          response.user?.name?.lastName,
        ),
      );
      this.updateUser(user);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private isAccessTokenExpiring(user: AuthUser): boolean {
    if (!user.expirationTime) {
      return false;
    }
    return Date.now() + 300000 > user.expirationTime;
  }

  async silentRestore(): Promise<void> {
    this.assertNoCredential();
    logger.log("Attempting silent restore...");
    this.loadFromCache();
    const user = this._currentUser;
    if (user) {
      try {
        if (user.provider === "google") {
          // Silent restore must never open interactive UI. A near-expiry
          // Google token can only be refreshed with user interaction, so a
          // deterministic typed result is returned instead.
          if (this.isAccessTokenExpiring(user)) {
            throw new AuthWebError(
              "interaction_required",
              "Google token refresh requires user interaction",
            );
          }
        } else if (
          user.provider === "microsoft" &&
          this.isAccessTokenExpiring(user) &&
          this._storage.loadRefreshToken()
        ) {
          // Network-only refresh: no popup is opened.
          await this.performRefreshToken(this._sessionGeneration);
        }
        logger.log("Silent restore successful");
      } catch (e) {
        const error = this.mapError(e, "refresh");
        logger.warn("Silent restore failed to refresh token:", error);
        throw error;
      }
    }
    this.notify();
  }

  logout(): void {
    const provider = this._currentUser?.provider;
    this._sessionGeneration++;
    this._currentUser = undefined;
    this._grantedScopes = [];
    this._microsoftTenant = undefined;
    this._loginInFlight = false;
    const rejectRefresh = this._refreshReject;
    this._refreshPromise = undefined;
    this._refreshReject = undefined;
    this.cancelActiveLogin();
    if (rejectRefresh) {
      rejectRefresh(
        new AuthWebError("not_signed_in", "Auth session was cleared"),
      );
    }
    this._storage.clearSession();
    if (!this._disposed) {
      this.notify();
      this.emitEvent("logout", provider);
    }
  }

  private updateUser(user: AuthUser) {
    this._captureLoginUser?.(user);
    if (this._credentialOnlyLogin) return;
    this._currentUser = user;
    this._storage.saveUser(user);
    this.notify();
  }

  setLoggingEnabled(enabled: boolean): void {
    logger.setEnabled(enabled);
  }

  name = "Auth";
  dispose() {
    this._disposed = true;
    this.logout();
    this.emitEvent("dispose");
    this._listeners = [];
    this._tokenListeners = [];
    this._eventListeners = [];
    this._snapshotListeners.clear();
  }
  equals(other: unknown) {
    return other === this;
  }
}

export let AuthModule: Auth = new AuthWeb();

export function resetAuthModule(auth: Auth): void {
  if (AuthModule === auth) {
    AuthModule = new AuthWeb();
  }
}

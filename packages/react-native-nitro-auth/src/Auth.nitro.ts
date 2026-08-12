import type { HybridObject } from "react-native-nitro-modules";

export type AuthProvider = "google" | "apple" | "microsoft";

export type AuthErrorCode =
  | "cancelled"
  | "interaction_required"
  | "timeout"
  | "popup_blocked"
  | "network_error"
  | "configuration_error"
  | "not_signed_in"
  | "operation_in_progress"
  | "unsupported_provider"
  | "invalid_state"
  | "invalid_nonce"
  | "token_error"
  | "no_id_token"
  | "parse_error"
  | "refresh_failed"
  | "unknown";

export type MicrosoftPrompt = "login" | "consent" | "select_account" | "none";

export interface LoginOptions {
  scopes?: string[];
  loginHint?: string;
  nonce?: string;
  useOneTap?: boolean;
  /** (iOS only) Use native sign-in sheet */
  useSheet?: boolean;
  /** Force account picker to show, ignoring any cached session or loginHint. On Android Google, this uses the legacy chooser path. */
  forceAccountPicker?: boolean;
  filterByAuthorizedAccounts?: boolean;
  /** (Android only) Use legacy Google Sign-In flow (e.g. for serverAuthCode) */
  useLegacyGoogleSignIn?: boolean;
  forceCodeForRefreshToken?: boolean;
  hostedDomain?: string;
  openIDRealm?: string;
  requestVerifiedPhoneNumber?: boolean;
  /** (Microsoft only) Azure AD tenant - "common", "organizations", "consumers", or tenant ID */
  tenant?: string;
  /** (Microsoft only) Prompt behavior for login */
  prompt?: MicrosoftPrompt;
}

export interface AuthTokens {
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  expirationTime?: number;
}

export interface AuthUser {
  provider: AuthProvider;
  email?: string;
  name?: string;
  photo?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  serverAuthCode?: string;
  authorizationCode?: string;
  userId?: string;
  phoneNumber?: string;
  hostedDomain?: string;
  scopes?: string[];
  expirationTime?: number;
  /**
   * @deprecated Reserved for compatibility. Structured failure details are
   * delivered through the `AuthError` envelope (`code`, `operation`, and
   * `underlyingMessage`), not through the signed-in user object.
   */
  underlyingError?: string;
}

export interface ScopeRevocationResult {
  /** Always false: scope revocation is local-only on every supported platform. */
  revokedAtProvider: false;
  revokedScopes: string[];
}

export type AuthEventType =
  | "login_started"
  | "login_succeeded"
  | "login_failed"
  | "tokens_refreshed"
  | "refresh_failed"
  | "session_changed"
  | "logout"
  | "dispose";

export interface AuthEvent {
  type: AuthEventType;
  provider?: AuthProvider;
  errorCode?: AuthErrorCode;
}

export interface Auth extends HybridObject<{ ios: "c++"; android: "c++" }> {
  readonly currentUser: AuthUser | undefined;
  readonly grantedScopes: string[];
  readonly hasPlayServices: boolean;

  login(provider: AuthProvider, options?: LoginOptions): Promise<void>;
  requestScopes(scopes: string[]): Promise<void>;
  revokeScopes(scopes: string[]): Promise<ScopeRevocationResult>;
  revokeAccess(): Promise<void>;
  getAccessToken(): Promise<string | undefined>;
  refreshToken(): Promise<AuthTokens>;

  logout(): void;
  silentRestore(): Promise<void>;

  onAuthStateChanged(
    callback: (user: AuthUser | undefined) => void,
  ): () => void;
  onTokensRefreshed(callback: (tokens: AuthTokens) => void): () => void;
  onAuthEvent(callback: (event: AuthEvent) => void): () => void;
  setLoggingEnabled(enabled: boolean): void;
}

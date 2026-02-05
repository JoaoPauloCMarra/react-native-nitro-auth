import type { HybridObject } from "react-native-nitro-modules";

import type { AuthStorageAdapter } from "./AuthStorage.nitro";

export type AuthProvider = "google" | "apple" | "microsoft";

export type AuthErrorCode =
  | "cancelled"
  | "network_error"
  | "configuration_error"
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
  useOneTap?: boolean;
  /** (iOS only) Use native sign-in sheet */
  useSheet?: boolean;
  /** Force account picker to show, ignoring any cached session or loginHint */
  forceAccountPicker?: boolean;
  /** (Microsoft only) Azure AD tenant - "common", "organizations", "consumers", or tenant ID */
  tenant?: string;
  /** (Microsoft only) Prompt behavior for login */
  prompt?: MicrosoftPrompt;
}

export interface AuthTokens {
  accessToken?: string;
  idToken?: string;
  expirationTime?: number;
}

export interface AuthUser {
  provider: AuthProvider;
  email?: string;
  name?: string;
  photo?: string;
  idToken?: string;
  accessToken?: string;
  serverAuthCode?: string;
  scopes?: string[];
  expirationTime?: number;
  /** Raw native error message */
  underlyingError?: string;
}

export interface Auth extends HybridObject<{ ios: "c++"; android: "c++" }> {
  readonly currentUser: AuthUser | undefined;
  readonly grantedScopes: string[];
  readonly hasPlayServices: boolean;

  login(provider: AuthProvider, options?: LoginOptions): Promise<void>;
  requestScopes(scopes: string[]): Promise<void>;
  revokeScopes(scopes: string[]): Promise<void>;
  getAccessToken(): Promise<string | undefined>;
  refreshToken(): Promise<AuthTokens>;

  logout(): void;
  silentRestore(): Promise<void>;

  onAuthStateChanged(
    callback: (user: AuthUser | undefined) => void,
  ): () => void;
  onTokensRefreshed(callback: (tokens: AuthTokens) => void): () => void;
  setLoggingEnabled(enabled: boolean): void;
  setStorageAdapter(adapter: AuthStorageAdapter | undefined): void;
}

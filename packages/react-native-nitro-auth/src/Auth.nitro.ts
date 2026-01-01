import type { HybridObject } from "react-native-nitro-modules";

import type { AuthStorageAdapter } from "./AuthStorage.nitro";

export type AuthProvider = "google" | "apple";

export type AuthErrorCode =
  | "cancelled"
  | "network_error"
  | "configuration_error"
  | "unsupported_provider"
  | "unknown";

export interface LoginOptions {
  scopes?: string[];
  loginHint?: string;
  useOneTap?: boolean;
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

  onAuthStateChanged(
    callback: (user: AuthUser | undefined) => void
  ): () => void;
  onTokensRefreshed(callback: (tokens: AuthTokens) => void): () => void;
  setLoggingEnabled(enabled: boolean): void;
  setStorageAdapter(adapter: AuthStorageAdapter | undefined): void;
}

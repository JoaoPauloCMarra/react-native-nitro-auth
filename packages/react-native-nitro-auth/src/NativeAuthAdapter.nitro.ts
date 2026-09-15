import type {
  AuthErrorCode,
  AuthNonce,
  AuthProvider,
  AuthTokens,
  AuthUser,
  LoginOptions,
} from "./Auth.nitro";
import type { HybridObject } from "react-native-nitro-modules";

/** Internal provider boundary. Failures are data until the C++ coordinator. */
export type ProviderFailure = {
  code: AuthErrorCode;
  detail?: string;
};

export type ProviderUserResult = {
  user?: AuthUser;
  failure?: ProviderFailure;
};

export type ProviderTokenResult = {
  tokens?: AuthTokens;
  failure?: ProviderFailure;
};

export type ProviderVoidResult = {
  failure?: ProviderFailure;
};

// Nitrogen discovers interfaces extending HybridObject; a type alias is not a spec.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface NativeAuthAdapter extends HybridObject<{
  ios: "swift";
  android: "kotlin";
}> {
  createNonce(): AuthNonce;
  login(
    provider: AuthProvider,
    options?: LoginOptions,
  ): Promise<ProviderUserResult>;
  requestScopes(scopes: string[]): Promise<ProviderUserResult>;
  refreshToken(): Promise<ProviderTokenResult>;
  silentRestore(): Promise<ProviderUserResult>;
  revokeAccess(provider: AuthProvider): Promise<ProviderVoidResult>;
  hasPlayServices(): boolean;
  invalidatePendingOperations(): void;
  cancel(): void;
  logout(): void;
}

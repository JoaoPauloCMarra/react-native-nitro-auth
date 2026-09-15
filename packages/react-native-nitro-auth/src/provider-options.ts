import type {
  Auth,
  AuthProvider,
  AuthUser,
  LoginOptions,
  ScopeRevocationResult,
} from "./Auth.nitro";

type StrictLoginOptions<AllowedKeys extends keyof LoginOptions> = Pick<
  LoginOptions,
  AllowedKeys
> &
  Partial<Record<Exclude<keyof LoginOptions, AllowedKeys>, never>>;

type WithoutNonce<Options> = Options extends LoginOptions
  ? Omit<Options, "nonce" | "useLegacyGoogleSignIn">
  : never;

type GoogleCommonKeys =
  "scopes" | "loginHint" | "nonce" | "forceAccountPicker" | "hostedDomain";

export type GoogleIOSLoginOptions = StrictLoginOptions<
  GoogleCommonKeys | "useSheet" | "openIDRealm"
>;

export type GoogleAndroidLoginOptions = StrictLoginOptions<
  | GoogleCommonKeys
  | "useOneTap"
  | "filterByAuthorizedAccounts"
  | "useLegacyGoogleSignIn"
  | "forceCodeForRefreshToken"
  | "requestVerifiedPhoneNumber"
>;

export type GoogleWebLoginOptions = StrictLoginOptions<
  GoogleCommonKeys | "openIDRealm"
>;

export type GoogleLoginOptions =
  GoogleIOSLoginOptions | GoogleAndroidLoginOptions | GoogleWebLoginOptions;

export type AppleIOSLoginOptions = StrictLoginOptions<"scopes" | "nonce">;
export type AppleWebLoginOptions = AppleIOSLoginOptions;
export type AppleLoginOptions = AppleIOSLoginOptions | AppleWebLoginOptions;

export type MicrosoftLoginOptions = StrictLoginOptions<
  "scopes" | "loginHint" | "tenant" | "prompt"
>;

export type LoginOptionsByProvider = {
  google: GoogleLoginOptions;
  apple: AppleLoginOptions;
  microsoft: MicrosoftLoginOptions;
};

export type ProviderLoginOptions<Provider extends AuthProvider> =
  LoginOptionsByProvider[Provider];

export type CredentialProvider = "google" | "apple";

export type CredentialOptions<Provider extends CredentialProvider> =
  Provider extends "google"
    ? WithoutNonce<GoogleLoginOptions>
    : WithoutNonce<AppleLoginOptions>;

export type AuthCredential = {
  provider: CredentialProvider;
  idToken: string;
  /** The raw nonce used to create the provider's ID token. */
  nonce: string;
  user: AuthUser;
};

export type AuthLogin = <Provider extends AuthProvider>(
  provider: Provider,
  options?: ProviderLoginOptions<Provider>,
) => Promise<void>;

export type AuthLoginAndGetUser = <Provider extends AuthProvider>(
  provider: Provider,
  options?: ProviderLoginOptions<Provider>,
) => Promise<AuthUser>;

export type AuthGetCredential = <Provider extends CredentialProvider>(
  provider: Provider,
  options?: CredentialOptions<Provider>,
) => Promise<AuthCredential>;

export type TypedAuth = Omit<Auth, "login" | "createNonce"> & {
  login: AuthLogin;
  loginAndGetUser: AuthLoginAndGetUser;
  getCredential: AuthGetCredential;
  revokeScopesWithResult: (scopes: string[]) => Promise<ScopeRevocationResult>;
};

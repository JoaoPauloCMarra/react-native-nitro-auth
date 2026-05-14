import type { Auth, AuthProvider, LoginOptions } from "./Auth.nitro";

type StrictLoginOptions<AllowedKeys extends keyof LoginOptions> = Pick<
  LoginOptions,
  AllowedKeys
> &
  Partial<Record<Exclude<keyof LoginOptions, AllowedKeys>, never>>;

type GoogleCommonKeys =
  | "scopes"
  | "loginHint"
  | "nonce"
  | "forceAccountPicker"
  | "hostedDomain";

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
  | GoogleIOSLoginOptions
  | GoogleAndroidLoginOptions
  | GoogleWebLoginOptions;

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

export type AuthLogin = <Provider extends AuthProvider>(
  provider: Provider,
  options?: ProviderLoginOptions<Provider>,
) => Promise<void>;

export type TypedAuth = Omit<Auth, "login"> & {
  login: AuthLogin;
};

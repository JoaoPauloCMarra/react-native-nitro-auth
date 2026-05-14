import type {
  AuthLogin,
  GoogleAndroidLoginOptions,
  GoogleIOSLoginOptions,
  LoginOptionsByProvider,
  ProviderLoginOptions,
} from "../provider-options";

type Expect<T extends true> = T;
type IsAssignable<Source, Target> = Source extends Target ? true : false;
type IsRejected<Source, Target> =
  IsAssignable<Source, Target> extends false ? true : false;

const googleAndroidOptions = {
  scopes: ["email", "profile"],
  loginHint: "user@example.com",
  nonce: "nonce",
  useOneTap: true,
  forceAccountPicker: true,
  filterByAuthorizedAccounts: true,
  useLegacyGoogleSignIn: true,
  forceCodeForRefreshToken: true,
  hostedDomain: "company.com",
  requestVerifiedPhoneNumber: true,
} satisfies GoogleAndroidLoginOptions;

const googleIOSOptions = {
  scopes: ["email", "profile"],
  loginHint: "user@example.com",
  nonce: "nonce",
  forceAccountPicker: true,
  hostedDomain: "company.com",
  openIDRealm: "https://example.com",
} satisfies GoogleIOSLoginOptions;

const appleOptions = {
  scopes: ["email", "name"],
  nonce: "nonce",
} satisfies ProviderLoginOptions<"apple">;

const microsoftOptions = {
  scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
  loginHint: "user@example.com",
  tenant: "organizations",
  prompt: "select_account",
} satisfies LoginOptionsByProvider["microsoft"];

declare const login: AuthLogin;

void login("google", googleAndroidOptions);
void login("google", googleIOSOptions);
void login("apple", appleOptions);
void login("microsoft", microsoftOptions);

export type AppleRejectsTenant = Expect<
  IsRejected<{ tenant: "organizations" }, ProviderLoginOptions<"apple">>
>;
export type AppleRejectsLoginHint = Expect<
  IsRejected<{ loginHint: "user@example.com" }, ProviderLoginOptions<"apple">>
>;
export type MicrosoftRejectsNonce = Expect<
  IsRejected<{ nonce: "nonce" }, ProviderLoginOptions<"microsoft">>
>;
export type GoogleRejectsPrompt = Expect<
  IsRejected<{ prompt: "select_account" }, ProviderLoginOptions<"google">>
>;
export type AndroidGoogleRejectsOpenIDRealm = Expect<
  IsRejected<{ openIDRealm: "https://example.com" }, GoogleAndroidLoginOptions>
>;

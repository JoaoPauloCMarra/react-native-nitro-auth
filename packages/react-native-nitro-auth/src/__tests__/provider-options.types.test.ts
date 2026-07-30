import type {
  AuthLogin,
  AppleIOSLoginOptions,
  AppleLoginOptions,
  AppleWebLoginOptions,
  GoogleAndroidLoginOptions,
  GoogleIOSLoginOptions,
  GoogleWebLoginOptions,
  MicrosoftLoginOptions,
  ProviderLoginOptions,
  TypedAuth,
  UseAuthReturn,
} from "../index";

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;
type IsAssignable<Source, Target> = Source extends Target ? true : false;

type AppleTenant = AssertNever<NonNullable<AppleLoginOptions["tenant"]>>;
type ApplePrompt = AssertNever<NonNullable<AppleLoginOptions["prompt"]>>;
type AppleIOSLoginHint = AssertNever<
  NonNullable<AppleIOSLoginOptions["loginHint"]>
>;
type AppleWebHostedDomain = AssertNever<
  NonNullable<AppleWebLoginOptions["hostedDomain"]>
>;
type MicrosoftNonce = AssertNever<NonNullable<MicrosoftLoginOptions["nonce"]>>;
type MicrosoftUseOneTap = AssertNever<
  NonNullable<MicrosoftLoginOptions["useOneTap"]>
>;
type GoogleIOSUseOneTap = AssertNever<
  NonNullable<GoogleIOSLoginOptions["useOneTap"]>
>;
type GoogleAndroidOpenIDRealm = AssertNever<
  NonNullable<GoogleAndroidLoginOptions["openIDRealm"]>
>;
type GoogleWebUseSheet = AssertNever<
  NonNullable<GoogleWebLoginOptions["useSheet"]>
>;
type GoogleWebUseOneTap = AssertNever<
  NonNullable<GoogleWebLoginOptions["useOneTap"]>
>;
type ProviderGoogleTenant = AssertNever<
  NonNullable<ProviderLoginOptions<"google">["tenant"]>
>;
type ProviderAppleUseSheet = AssertNever<
  NonNullable<ProviderLoginOptions<"apple">["useSheet"]>
>;
type MicrosoftPromptValues = AssertTrue<
  NonNullable<MicrosoftLoginOptions["prompt"]> extends
    "login" | "consent" | "select_account" | "none"
    ? true
    : false
>;
type NativeAuthService = (typeof import("../index"))["AuthService"];
type WebAuthService = (typeof import("../index.web"))["AuthService"];
type NativeServiceUsesTypedAuth = AssertTrue<
  IsAssignable<NativeAuthService, TypedAuth>
>;
type WebServiceUsesTypedAuth = AssertTrue<
  IsAssignable<WebAuthService, TypedAuth>
>;
type TypedAuthUsesProviderLogin = AssertTrue<
  IsAssignable<TypedAuth["login"], AuthLogin>
>;
type HookUsesProviderLogin = AssertTrue<
  IsAssignable<UseAuthReturn["login"], AuthLogin>
>;
type WebProviderLoginOptions =
  import("../index.web").ProviderLoginOptions<"google">;
type WebUseAuthReturn = import("../index.web").UseAuthReturn;
type WebProviderOptionsMatchNative = AssertTrue<
  IsAssignable<WebProviderLoginOptions, ProviderLoginOptions<"google">>
>;
type WebHookUsesProviderLogin = AssertTrue<
  IsAssignable<WebUseAuthReturn["login"], AuthLogin>
>;

const googleAndroidOptions = {
  useOneTap: true,
  filterByAuthorizedAccounts: true,
  requestVerifiedPhoneNumber: true,
} satisfies GoogleAndroidLoginOptions;

const googleIOSOptions = {
  hostedDomain: "company.com",
  openIDRealm: "https://example.com",
} satisfies GoogleIOSLoginOptions;

const microsoftOptions = {
  tenant: "organizations",
  prompt: "select_account",
} satisfies MicrosoftLoginOptions;

const login: AuthLogin = async () => {};

test("provider login option types compile", () => {
  expect(googleAndroidOptions.useOneTap).toBe(true);
  expect(googleIOSOptions.openIDRealm).toBe("https://example.com");
  expect(microsoftOptions.prompt).toBe("select_account");
});

void login("google", googleAndroidOptions);
void login("apple", { nonce: "nonce" });
void login("microsoft", microsoftOptions);

void (0 as unknown as AppleTenant);
void (0 as unknown as ApplePrompt);
void (0 as unknown as AppleIOSLoginHint);
void (0 as unknown as AppleWebHostedDomain);
void (0 as unknown as MicrosoftNonce);
void (0 as unknown as MicrosoftUseOneTap);
void (0 as unknown as GoogleIOSUseOneTap);
void (0 as unknown as GoogleAndroidOpenIDRealm);
void (0 as unknown as GoogleWebUseSheet);
void (0 as unknown as GoogleWebUseOneTap);
void (0 as unknown as ProviderGoogleTenant);
void (0 as unknown as ProviderAppleUseSheet);
void (0 as unknown as MicrosoftPromptValues);
void (0 as unknown as NativeServiceUsesTypedAuth);
void (0 as unknown as WebServiceUsesTypedAuth);
void (0 as unknown as TypedAuthUsesProviderLogin);
void (0 as unknown as HookUsesProviderLogin);
void (0 as unknown as WebProviderOptionsMatchNative);
void (0 as unknown as WebHookUsesProviderLogin);

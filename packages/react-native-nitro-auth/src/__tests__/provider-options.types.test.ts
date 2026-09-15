import type {
  AuthLifecycleEvent,
  AuthLogin,
  AuthLoginAndGetUser,
  AuthGetCredential,
  CredentialOptions,
  CredentialProvider,
  AuthError,
  AppleAndroidLoginOptions,
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
type AppleAndroidNameScope = AssertNever<
  Extract<NonNullable<AppleAndroidLoginOptions["scopes"]>[number], "name">
>;
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
type TypedAuthUsesLoginAndGetUser = AssertTrue<
  IsAssignable<TypedAuth["loginAndGetUser"], AuthLoginAndGetUser>
>;
type TypedAuthUsesGetCredential = AssertTrue<
  IsAssignable<TypedAuth["getCredential"], AuthGetCredential>
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
type GoogleCredentialOptions = CredentialOptions<"google">;
type AppleCredentialOptions = CredentialOptions<"apple">;
type CredentialProviderValues = AssertTrue<
  IsAssignable<CredentialProvider, "google" | "apple"> extends true
    ? IsAssignable<"google" | "apple", CredentialProvider>
    : false
>;
type GoogleCredentialRejectsNonce = AssertTrue<
  "nonce" extends keyof GoogleCredentialOptions ? false : true
>;
type AppleCredentialRejectsNonce = AssertTrue<
  "nonce" extends keyof AppleCredentialOptions ? false : true
>;
type GoogleCredentialRejectsLegacy = AssertTrue<
  "useLegacyGoogleSignIn" extends keyof GoogleCredentialOptions ? false : true
>;
type SocialButtonErrorCallback = (error: AuthError) => void;
type BroadSocialButtonErrorCallback = (error: unknown) => void;
type NativeSocialButtonError = AssertTrue<
  IsAssignable<
    NonNullable<import("../index").SocialButtonProps["onError"]>,
    SocialButtonErrorCallback
  >
>;
type NativeSocialButtonAcceptsAuthError = AssertTrue<
  IsAssignable<
    SocialButtonErrorCallback,
    NonNullable<import("../index").SocialButtonProps["onError"]>
  >
>;
type NativeSocialButtonAcceptsBroadError = AssertTrue<
  IsAssignable<
    BroadSocialButtonErrorCallback,
    NonNullable<import("../index").SocialButtonProps["onError"]>
  >
>;
type WebSocialButtonError = AssertTrue<
  IsAssignable<
    NonNullable<import("../index.web").SocialButtonProps["onError"]>,
    SocialButtonErrorCallback
  >
>;
type WebSocialButtonAcceptsAuthError = AssertTrue<
  IsAssignable<
    SocialButtonErrorCallback,
    NonNullable<import("../index.web").SocialButtonProps["onError"]>
  >
>;
type WebSocialButtonAcceptsBroadError = AssertTrue<
  IsAssignable<
    BroadSocialButtonErrorCallback,
    NonNullable<import("../index.web").SocialButtonProps["onError"]>
  >
>;

const googleAndroidOptions = {
  useOneTap: true,
  filterByAuthorizedAccounts: true,
  requestVerifiedPhoneNumber: true,
} satisfies GoogleAndroidLoginOptions;

const appleAndroidOptions = {
  scopes: ["email", "fullName"],
  nonce: "nonce",
} satisfies AppleAndroidLoginOptions;

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
  expect(appleAndroidOptions.scopes).toEqual(["email", "fullName"]);
  expect(googleIOSOptions.openIDRealm).toBe("https://example.com");
  expect(microsoftOptions.prompt).toBe("select_account");
});

void login("google", googleAndroidOptions);
void login("apple", { nonce: "nonce" });
void login("microsoft", microsoftOptions);

void (0 as unknown as AppleTenant);
void (0 as unknown as AppleAndroidNameScope);
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
void (0 as unknown as TypedAuthUsesLoginAndGetUser);
void (0 as unknown as TypedAuthUsesGetCredential);
void (0 as unknown as HookUsesProviderLogin);
void (0 as unknown as WebProviderOptionsMatchNative);
void (0 as unknown as WebHookUsesProviderLogin);
void (0 as unknown as CredentialProviderValues);
void (0 as unknown as GoogleCredentialRejectsNonce);
void (0 as unknown as AppleCredentialRejectsNonce);
void (0 as unknown as GoogleCredentialRejectsLegacy);
void (0 as unknown as NativeSocialButtonError);
void (0 as unknown as NativeSocialButtonAcceptsAuthError);
void (0 as unknown as NativeSocialButtonAcceptsBroadError);
void (0 as unknown as WebSocialButtonError);
void (0 as unknown as WebSocialButtonAcceptsAuthError);
void (0 as unknown as WebSocialButtonAcceptsBroadError);

function checkEventNarrowing(event: AuthLifecycleEvent) {
  if (event.type === "operation_failed") {
    const code: import("../index").AuthErrorCode = event.errorCode;
    const duration: number = event.elapsedMilliseconds;
    void code;
    void duration;
    // @ts-expect-error Lifecycle metadata must not expose credentials.
    void event.idToken;
  }
  if (event.type === "operation_started") {
    const id: number = event.operationId;
    void id;
    // @ts-expect-error Start events have no terminal timing.
    void event.elapsedMilliseconds;
  }
}
void checkEventNarrowing;

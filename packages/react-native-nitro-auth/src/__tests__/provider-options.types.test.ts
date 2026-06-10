import type {
  AuthLogin,
  AppleLoginOptions,
  GoogleAndroidLoginOptions,
  GoogleIOSLoginOptions,
  MicrosoftLoginOptions,
  ProviderLoginOptions,
} from "../provider-options";

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;

type AppleTenant = AssertNever<NonNullable<AppleLoginOptions["tenant"]>>;
type ApplePrompt = AssertNever<NonNullable<AppleLoginOptions["prompt"]>>;
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
type ProviderGoogleTenant = AssertNever<
  NonNullable<ProviderLoginOptions<"google">["tenant"]>
>;
type ProviderAppleUseSheet = AssertNever<
  NonNullable<ProviderLoginOptions<"apple">["useSheet"]>
>;
type MicrosoftPromptValues = AssertTrue<
  NonNullable<MicrosoftLoginOptions["prompt"]> extends
    | "login"
    | "consent"
    | "select_account"
    | "none"
    ? true
    : false
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
void (0 as unknown as MicrosoftNonce);
void (0 as unknown as MicrosoftUseOneTap);
void (0 as unknown as GoogleIOSUseOneTap);
void (0 as unknown as GoogleAndroidOpenIDRealm);
void (0 as unknown as ProviderGoogleTenant);
void (0 as unknown as ProviderAppleUseSheet);
void (0 as unknown as MicrosoftPromptValues);

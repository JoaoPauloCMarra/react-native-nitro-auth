import type {
  AppleLoginOptions,
  GoogleAndroidLoginOptions,
  GoogleIOSLoginOptions,
  MicrosoftLoginOptions,
} from "../provider-options";

type AssertNever<T extends never> = T;

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

test("provider login option types compile", () => {
  expect(googleAndroidOptions.useOneTap).toBe(true);
  expect(googleIOSOptions.openIDRealm).toBe("https://example.com");
  expect(microsoftOptions.prompt).toBe("select_account");
});

void (0 as unknown as AppleTenant);
void (0 as unknown as ApplePrompt);
void (0 as unknown as MicrosoftNonce);
void (0 as unknown as MicrosoftUseOneTap);
void (0 as unknown as GoogleIOSUseOneTap);
void (0 as unknown as GoogleAndroidOpenIDRealm);

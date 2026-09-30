# react-native-nitro-auth

[![npm version](https://img.shields.io/npm/v/react-native-nitro-auth?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-auth)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-auth?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-auth)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-auth?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-0.86.3-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057%20%28RN%200.86.3%29-000020)](https://docs.expo.dev/versions/v57.0.0/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.37.0%20%3C0.38.0-black)](https://nitro.margelo.com/)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178c6)](https://www.typescriptlang.org/)

Google Sign-In, Apple Sign-In, and Microsoft Entra ID for React Native and
Expo, powered by Nitro Modules.

Use it when you want one typed authentication API for native social login, web
OAuth, token refresh, incremental scopes, account listeners, and consistent
`AuthError` handling. Native refresh tokens stay in memory. Web session metadata
uses configurable browser storage, with token persistence disabled by default.
Your backend remains responsible for validating tokens and creating application
sessions.

## Install

```sh
bun add react-native-nitro-auth react-native-nitro-modules
```

For Expo development builds:

```sh
bunx expo install react-native-nitro-auth react-native-nitro-modules
bunx expo prebuild
```

For bare React Native apps:

```sh
cd ios && pod install
```

Expo Go cannot load Nitro native modules. Use an Expo development build or a
bare app.

Optional peers:

- `react-native-svg` (`>=15.8.0`) is needed only when you import
  `react-native-nitro-auth/official-buttons/svg`. Install it with
  `bunx expo install react-native-svg` or `bun add react-native-svg`.
- `expo` is needed only for the Expo config plugin. Expo apps already have it.
- `expo-constants` is needed only to read web client IDs from `expo.extra`.

## Requirements

| Dependency                 | Supported range or validated baseline                                            |
| -------------------------- | -------------------------------------------------------------------------------- |
| React Native               | `>=0.76.0`; tested on `0.86.3`, RN `0.87` Strict TypeScript compatibility check  |
| React                      | Validated with `19.2.3`                                                          |
| React Native Nitro Modules | `>=0.37.0 <0.38.0`                                                               |
| Expo                       | SDK `>=52` development builds; tested on SDK `57.0.26` with RN `0.86.3`          |
| iOS                        | React Native's `min_ios_version_supported` (`15.1` on RN `0.76`–`0.86`)          |
| Android                    | compileSdk `35`, Android Gradle Plugin `8.6`, Kotlin `1.9.25`, NDK `27` or later |

### Compatibility

The package is tested on React Native `0.86.3` with Expo SDK `57`. It supports
React Native `0.76` or later and Expo SDK `52` or later.

React Native `0.76` and Expo SDK `52` apps must set the Android `ndkVersion` to
`27` or later, because `react-native-nitro-modules` `0.37` requires NDK r27.
Their templates default to NDK `26.1`. In Expo SDK `52`, set it through
`expo-build-properties`:

```js
["expo-build-properties", { android: { ndkVersion: "27.1.12297006" } }];
```

In a bare React Native `0.76` app, set `ndkVersion = "27.1.12297006"` in the
`ext` block of `android/build.gradle`.

iOS static frameworks are supported with source-built React Native. After
upgrading, regenerate the Expo native project or run `pod install`, then rebuild
the app so CocoaPods applies the updated header paths.

## Expo Config

Add the plugin to `app.json` or `app.config.js` before prebuild:

```js
export default {
  expo: {
    scheme: "myapp",
    ios: {
      bundleIdentifier: "com.company.myapp",
    },
    android: {
      package: "com.company.myapp",
    },
    plugins: [
      [
        "react-native-nitro-auth",
        {
          ios: {
            googleClientId: process.env.GOOGLE_IOS_CLIENT_ID,
            googleServerClientId: process.env.GOOGLE_SERVER_CLIENT_ID,
            appleSignIn: true,
            microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
            microsoftTenant: process.env.MICROSOFT_TENANT,
            microsoftB2cDomain: process.env.MICROSOFT_B2C_DOMAIN,
          },
          android: {
            googleClientId: process.env.GOOGLE_WEB_CLIENT_ID,
            appleAndroidBrokerUrl: "https://auth.example.com/apple",
            appleAndroidCallbackScheme: "myapp-auth",
            microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
            microsoftTenant: process.env.MICROSOFT_TENANT,
            microsoftB2cDomain: process.env.MICROSOFT_B2C_DOMAIN,
          },
        },
      ],
    ],
    extra: {
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
      appleWebClientId: process.env.APPLE_WEB_CLIENT_ID,
      microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
      microsoftTenant: process.env.MICROSOFT_TENANT,
      microsoftB2cDomain: process.env.MICROSOFT_B2C_DOMAIN,
      nitroAuthWebStorage: "session",
    },
  },
};
```

Plugin options:

| Option                               | Platform | Required for                                                                     |
| ------------------------------------ | -------- | -------------------------------------------------------------------------------- |
| `ios.googleClientId`                 | iOS      | Google Sign-In on iOS.                                                           |
| `ios.googleServerClientId`           | iOS      | Google server auth code flow.                                                    |
| `ios.googleUrlScheme`                | iOS      | Optional Google redirect scheme. Derived from `ios.googleClientId` when omitted. |
| `ios.appleSignIn`                    | iOS      | Apple Sign-In entitlement. Personal Apple teams cannot provision this.           |
| `ios.microsoftClientId`              | iOS      | Microsoft Entra ID native login.                                                 |
| `ios.microsoftTenant`                | iOS      | Microsoft tenant override.                                                       |
| `ios.microsoftB2cDomain`             | iOS      | Microsoft B2C hostname.                                                          |
| `android.googleClientId`             | Android  | Google Sign-In on Android.                                                       |
| `android.appleAndroidBrokerUrl`      | Android  | HTTPS base URL of your Apple broker. Required together with the callback scheme. |
| `android.appleAndroidCallbackScheme` | Android  | App-specific lowercase custom scheme, such as `myapp-auth`.                      |
| `android.microsoftClientId`          | Android  | Microsoft Entra ID native login.                                                 |
| `android.microsoftTenant`            | Android  | Microsoft tenant override.                                                       |
| `android.microsoftB2cDomain`         | Android  | Microsoft B2C hostname.                                                          |

`ios.microsoftClientId` also needs `ios.bundleIdentifier`: the plugin registers
the `msauth.<bundleIdentifier>` URL scheme from it and warns when it is missing.

When `ios.googleUrlScheme` is omitted, the plugin derives
`com.googleusercontent.apps.<id>` from an iOS client ID that ends in
`.apps.googleusercontent.com`. Set `ios.googleUrlScheme` only to override that
value.

Web reads provider client IDs from `expo.extra`; native platforms read values
written by the plugin during prebuild.

Web options in `expo.extra`:

| Option                         | Default   | Purpose                                         |
| ------------------------------ | --------- | ----------------------------------------------- |
| `googleWebClientId`            | —         | Google OAuth client ID.                         |
| `appleWebClientId`             | —         | Apple Services ID.                              |
| `microsoftClientId`            | —         | Microsoft Entra ID application ID.              |
| `microsoftTenant`              | `common`  | Microsoft tenant, domain, or B2C policy.        |
| `microsoftB2cDomain`           | —         | Microsoft B2C hostname.                         |
| `nitroAuthWebStorage`          | `session` | `session`, `local`, or `memory`.                |
| `nitroAuthPersistTokensOnWeb`  | `false`   | Persist token fields in configured storage.     |
| `nitroAuthPersistProfileOnWeb` | `true`    | Persist email/name/photo in configured storage. |

Web reads `expo-constants` for these options. `expo-constants` is an optional
peer dependency: without it, web falls back to defaults and provider client
IDs must be configured another way.

### Apple on Android

Google and Apple use the same calls on Android and iOS:

```ts
const credential = await AuthService.getCredential("apple");
```

Android Apple opens a Custom Tab and requires a server broker. Configure the two
Android plugin options above, then prebuild and rebuild. The plugin installs
the resources and callback Activity; the app needs no browser or deep-link
handler. Use a callback scheme distinct from the app's other auth links.
Broker URLs must use HTTPS without credentials, query parameters, or fragments.
For bare Android, define `nitro_auth_apple_android_broker_url` and
`nitro_auth_apple_android_callback_scheme` string resources and register a VIEW,
DEFAULT, BROWSABLE intent filter on `com.auth.AppleAuthCallbackActivity` for the
configured scheme, host `apple`, and exact path `/callback`.

The broker is hosted by your backend; it has no
Supabase dependency. Register an Apple Services ID associated with your Sign in
with Apple App ID, and an HTTPS return URL pointing to the broker. Keep Apple
signing keys and client secrets on the server. Native iOS continues using the
App ID and native Apple authorization UI.

Implement these endpoints relative to `appleAndroidBrokerUrl`:

1. `POST /start` accepts `{nonce, codeChallenge, scopes?}`. Nonce and challenge
   are lowercase SHA-256 hex. Scopes contain only `email` and `fullName`; map
   `fullName` to Apple's OAuth `name` scope. Return
   `{data:{attemptId, authorizationUrl}}`, where `attemptId` is a canonical UUID
   and the URL starts at `https://appleid.apple.com/auth/authorize`.
2. Your HTTPS Apple callback verifies state and the Apple token's signature,
   issuer, audience, expiry, and nonce. Store the result privately and redirect
   to `myapp-auth://apple/callback?attemptId=<UUID>`. Do not put credentials or
   the proof verifier in this URL.
3. `POST /complete` accepts `{attemptId, codeVerifier}`. The verifier is 32 random
   bytes encoded as 64 lowercase hex characters; its SHA-256 hex digest must
   equal the stored challenge. Atomically consume the matching unexpired
   attempt and return
   `{data:{idToken, authorizationCode, user:{id,email?,name?,firstName?,lastName?}}}`.
   Required fields must be nonempty strings. Optional names/email may be absent
   or null. Derive `user.id` from the verified Apple subject.

Use no-store responses, encrypted credential storage, short attempt expiry,
request limits, and single-use proof consumption. Return failures as
`{error:{code,message}}`; Apple cancellation uses HTTP 409 with
`APPLE_AUTHORIZATION_CANCELLED`. The package exposes fixed error descriptions,
rejects redirects and oversized responses, and accepts only the active attempt's
callback. The package manages nonce/proof generation, browser cancellation,
request deadlines, and transient cleanup. It returns the original nonce with
`getCredential()` for your application's final server session exchange.

### Microsoft redirect URIs

Register these redirect URIs in the Microsoft Entra app registration:

| Platform | Redirect URI                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Android  | `msauth://<applicationId>/<microsoftClientId>`, for example `msauth://com.company.myapp/<client-id>` |
| iOS      | `msauth.<bundleIdentifier>://auth`, for example `msauth.com.company.myapp://auth`                    |
| Web      | The page origin, as described in [Web OAuth redirects](#web-oauth-redirects)                         |

The Android value is not the Azure portal's default Android redirect
(`msauth://<package>/<signature-hash>`). Add it as a custom redirect URI of a
"Mobile and desktop applications" platform.

The Expo plugin registers both schemes. For a bare Android app, add string
resources `nitro_auth_microsoft_client_id` (and optionally
`nitro_auth_microsoft_tenant` and `nitro_auth_microsoft_b2c_domain`), then add
this intent filter to `com.auth.MicrosoftAuthActivity` in the app manifest:

```xml
<activity android:name="com.auth.MicrosoftAuthActivity" android:exported="true">
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
      android:scheme="msauth"
      android:host="com.company.myapp"
      android:path="/YOUR_MICROSOFT_CLIENT_ID" />
  </intent-filter>
</activity>
```

For a bare iOS app, set `MSALClientID` (and optionally `MSALTenant` and
`MSALB2cDomain`) in `Info.plist` and add `msauth.<bundleIdentifier>` to
`CFBundleURLTypes`.

### Web OAuth redirects

Web Google, Microsoft, and Apple flows use `window.location.origin` as the OAuth
redirect URI. Register the exact origin with each provider, without adding an
OAuth callback path. Google and Microsoft complete in a popup; their callbacks
may return query or hash parameters at the page root. The package accepts only
that registered root target, verifies `state` before reading the response, and
verifies the identity-token `nonce` before creating a session. Apple uses the
same origin through the Apple JS popup flow.

On iOS, the plugin also applies the CocoaPods modular-header settings required
by the Google Sign-In dependency chain (`AppCheckCore`, `GoogleUtilities`, and
`RecaptchaInterop`). It appends only the missing pods to `apple.extraPods` in
`Podfile.properties.json` and leaves every other property unchanged, so the
package does not depend on `expo-build-properties`. If you also set
`ios.extraPods` in `expo-build-properties`, list `react-native-nitro-auth`
before `expo-build-properties` in `plugins`. In the other order,
`expo-build-properties` replaces the whole list; add the three pods to your
`extraPods` in that case.

Microsoft tenant values are validated before opening the authorization URL. Use
`common`, `organizations`, `consumers`, a tenant ID, or a tenant domain for
standard Entra ID. For B2C, set `microsoftB2cDomain` to a hostname such as
`contoso.b2clogin.com` and set `microsoftTenant` to a policy such as
`B2C_1_signin`. For custom B2C domains, set `microsoftTenant` to a tenant/policy
path such as `contoso.onmicrosoft.com/B2C_1_signin`.

## Quick Start

```tsx
import { Button } from "react-native";
import { useAuth, type ProviderLoginOptions } from "react-native-nitro-auth";

export function SignInButton() {
  const { user, login, logout } = useAuth();

  async function signInWithGoogle() {
    const options: ProviderLoginOptions<"google"> = {
      scopes: ["openid", "profile", "email"],
    };

    await login("google", options);
  }

  if (user) {
    return <Button title="Sign out" onPress={logout} />;
  }

  return <Button title="Continue with Google" onPress={signInWithGoogle} />;
}
```

Imperative callers can use the same provider-aware options:

```ts
import { AuthError, AuthService } from "react-native-nitro-auth";

async function signInWithGoogle() {
  try {
    const user = await AuthService.loginAndGetUser("google", {
      forceAccountPicker: true,
    });
    return user.idToken;
  } catch (error) {
    if (
      error instanceof AuthError &&
      (error.code === "cancelled" || error.code === "timeout")
    ) {
      return undefined;
    }
    throw error;
  }
}

async function signInWithMicrosoft() {
  await AuthService.login("microsoft", {
    tenant: "organizations",
    prompt: "select_account",
  });
}
```

`login()` still returns `Promise<void>` and leaves the session on
`AuthService.currentUser`. `loginAndGetUser()` returns the user captured by its
own login completion, even if a later operation replaces the session. `logout()` is synchronous and
returns `void`.

Use `getCredential()` when the app sends an identity-provider token to its own
backend and does not need a local package session:

```ts
const credential = await AuthService.getCredential("google", {
  forceAccountPicker: true,
});

await fetch(yourAuthEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    provider: credential.provider,
    idToken: credential.idToken,
    nonce: credential.nonce,
  }),
});
```

`getCredential()` supports Google and Apple. It creates a random nonce, sends
its SHA-256 hex value to the provider, returns the raw nonce for backend
verification, and clears provider state before resolving without publishing a
package session.
If a package session is already active, it rejects with `invalid_state` before
provider setup or session changes; call `logout()` before requesting a separate
credential.
While acquisition is pending, another credential or session operation rejects
with `operation_in_progress`; `logout()` and `dispose()` can cancel it. Cleanup
preserves the original acquisition error if cleanup also fails. Credential acquisition emits correlated operation events without temporary
login, state, or logout events.
Google defaults to `openid`, `email`, and `profile`; Apple defaults to `email`
and `fullName` (`name` in Apple's web SDK). Explicit `scopes` replace those defaults. Caller-supplied `nonce`
and Android `useLegacyGoogleSignIn` are not accepted. Android nonce-bound Google
flows use Credential Manager even with `forceAccountPicker: true`; they reject
when Credential Manager cannot provide and verify a matching ID token instead
of retrying through legacy Google Sign-In.

## Providers

| Provider  | Native       | Web | Notes                                                                                  |
| --------- | ------------ | --- | -------------------------------------------------------------------------------------- |
| Google    | iOS, Android | Yes | Supports account picker, login hint, refresh, and incremental scopes.                  |
| Apple     | iOS, Android | Yes | Native iOS; HTTPS broker on Android. Name/email may be absent on repeat authorization. |
| Microsoft | iOS, Android | Yes | Supports tenant, B2C, refresh, and incremental scopes.                                 |

Use `expo-auth-session`,
`react-native-app-auth`, Auth0, Firebase Auth, or your identity provider SDK
when you need generic OAuth/OIDC providers, password authentication, MFA,
hosted user management, or server session management.

## API

Main exports:

- `useAuth()` for reactive user, scope, loading, and error state.
- `AuthService` for imperative operations and account listeners.
- `AuthService.loginAndGetUser()` when the caller needs the signed-in user from
  the same call.
- `AuthService.getCredential()` when the caller needs a nonce-bound Google or
  Apple ID token without retaining a package session.
- `SocialButton` for provider-aware UI in `custom` mode.
- `OfficialSocialButton` from `react-native-nitro-auth/official-buttons` for
  official Google and Apple button artwork.
- `AuthProvider` for `"google"`, `"apple"`, and `"microsoft"`.
- `AuthError` and `AuthErrorCode` for deterministic failures.
- Provider-specific option types for strongly typed login calls.

Both `useAuth().login()` and `AuthService.login()` reject option fields that do
not belong to the selected provider:

```ts
import type {
  ProviderLoginOptions,
  MicrosoftLoginOptions,
} from "react-native-nitro-auth";

const googleOptions: ProviderLoginOptions<"google"> = {
  scopes: ["openid", "email"],
  hostedDomain: "company.com",
  forceAccountPicker: true,
};

const microsoftOptions: MicrosoftLoginOptions = {
  tenant: "organizations",
  prompt: "select_account",
};
```

Supported login options:

| Provider  | Options                                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google    | `scopes`, `loginHint`, `nonce`, `forceAccountPicker`, `hostedDomain`, `useSheet`, `openIDRealm`, `useOneTap`, `filterByAuthorizedAccounts`, `useLegacyGoogleSignIn`, `forceCodeForRefreshToken`, `requestVerifiedPhoneNumber` |
| Apple     | `scopes`, `nonce`                                                                                                                                                                                                             |
| Microsoft | `scopes`, `loginHint`, `tenant`, `prompt`                                                                                                                                                                                     |

`prompt` is typed as `"login"`, `"consent"`, `"select_account"`, or `"none"`.

- Apple `nonce` on Android must be a 64-character lowercase SHA-256 hex value,
  because the Apple broker contract accepts only that format; other values
  reject with `invalid_nonce`. iOS and web pass the value to Apple unchanged,
  so pass the same hashed value on every platform to get the same `nonce`
  claim.
- Google `useSheet` and `forceAccountPicker` on iOS sign out of the local
  Google SDK session before sign-in so the account picker shows. They do not
  revoke the app's grant; only `revokeAccess()` does.
- Google `hostedDomain` on Android uses the Credential Manager "Sign in with
  Google" option, which always shows the account picker.

### Session operations

- `logout()` is synchronous and returns `void`. It clears package session state
  and signs out provider SDK state where available. It does not revoke a
  provider grant or your backend session. Do not `await` it.
- `silentRestore()` resolves with or without a restorable session. It never
  opens interactive UI: a near-expiry Google session rejects with
  `interaction_required` instead of showing a popup.
- `requestScopes()` supports Google and Microsoft and may require user
  interaction.
- `revokeScopes()` removes scopes from package state and preserves its
  `Promise<void>` contract. `revokeScopesWithResult()` returns
  `{ revokedAtProvider: false, revokedScopes }`. Neither method revokes scopes
  at the provider.
- `getAccessToken()` returns the current access token and refreshes near-expiry
  Google or Microsoft credentials when supported.
- On iOS and Android, `refreshToken()` (and `getAccessToken()` when it has to
  refresh) rejects with `operation_in_progress` while a `login()`,
  `requestScopes()`, or `silentRestore()` is pending. It never cancels that
  operation. Retry after it settles.
- `refreshToken()` supports Google and Microsoft. Apple token exchange and
  refresh belong on your backend. Native Apple sessions reject `refreshToken()`
  and `requestScopes()` with `unsupported_provider` while preserving the session.
- `revokeAccess()` clears local state only after provider revocation succeeds.
  Client-side revocation supports Google web and iOS sessions, plus Android
  sessions created through legacy Google Sign-In. Unsupported providers reject
  with `unsupported_provider`. Android Google sessions without any active
  session reject with `not_signed_in`. Signed-in Credential Manager/One-Tap
  sessions are not eligible for client-side provider revocation and reject with
  `unsupported_provider`; local session state is unchanged.

`SocialButton` normalizes runtime failures to `AuthError` instances. Its
`onError` callback receives an `AuthError`, so TypeScript exposes `code`,
`operation`, and `underlyingMessage` without a cast. Use
`error instanceof AuthError` when handling an error value that came from
outside the package.

### Social buttons

`SocialButton` renders Google, Apple, and Microsoft controls with
provider-aware React Native content. `custom` is its only `renderMode`. Its
import does not bundle the official button artwork or `react-native-svg`.
`appearance` accepts `light` or `dark`; `shape` accepts `pill` or
`rectangular`. For Google and Apple, the deprecated `variant` values `primary`,
`outline`, and `white` map to `light`; `black` maps to `dark`.

Set `iconOnly` to render the provider's official square icon without cropping
the full button. It defaults to `false`; icon-only buttons remain 48 × 48 dp
targets and keep the accessible label “Sign in with Google” or “Sign in with
Apple”.

While a login runs, every render mode keeps the provider mark, the button
chrome, and the button size. Labeled buttons show the mark with the indicator
beside it; icon-only buttons dim the mark and center the indicator over it.
Turning `loading` on or off never moves or resizes the control.

Custom content receives a `width` prop. For Google and Apple it is the button
width. For Microsoft it is the window width, because the Microsoft button fills
its parent; size Microsoft custom content from its own layout instead.

Custom content can use the exported `SocialProviderIcon` for Google or Apple
artwork without copying assets or loading a font. Set `loadingIndicator={null}`
when that content renders its own loading state; this removes the default
indicator while preserving the outer button's
busy state and duplicate-press protection. A React element passed as
`loadingIndicator` replaces the default indicator inside the button.

```tsx
<SocialButton provider="google" appearance="light" shape="pill" />
<SocialButton provider="apple" appearance="dark" iconOnly />
```

#### Official button artwork

`OfficialSocialButton` renders the official Google or Apple full-button artwork.
Two subpaths export it:

| Import                                         | Artwork                                 | Needs `react-native-svg` |
| ---------------------------------------------- | --------------------------------------- | ------------------------ |
| `react-native-nitro-auth/official-buttons`     | PNG (`renderMode="image"`, the default) | No                       |
| `react-native-nitro-auth/official-buttons/svg` | SVG by default, or PNG with `"image"`   | Yes (optional peer)      |

```tsx
import { OfficialSocialButton } from "react-native-nitro-auth/official-buttons";
import { OfficialSocialButton as OfficialSvgButton } from "react-native-nitro-auth/official-buttons/svg";

<OfficialSocialButton provider="google" />
<OfficialSvgButton provider="apple" iconOnly />
```

The image subpath does not load `react-native-svg` or the inlined SVG artwork.
Metro bundles every static import, so apps that never import the `svg` subpath
do not ship that code. Both modes preserve the platform artwork's aspect
ratio. `OfficialSocialButton` accepts the same login, loading, `iconOnly`,
`appearance`, `shape`, accessibility, and error props as `SocialButton`. It does
not accept `customComponents`, `textStyle`, or `borderRadius`, and it supports
Google and Apple only.

When provided, `onPress` replaces the package-managed login and may return a
promise. The component disables itself and reports progress while it settles;
`loading` adds a controlled busy state. Rejections are normalized and passed to
`onError` as `AuthError`.

Custom mode draws its label in the platform system font, which is Roboto on
Android and San Francisco on iOS, and needs no bundled font. To use Google Sans
Medium instead, set the Expo config plugin's `googleButtonFont` option to `true`
in the existing `react-native-nitro-auth` plugin options and pass the family
through `textStyle`:

```js
[
  "react-native-nitro-auth",
  { googleButtonFont: true /* keep other options */ },
];
```

```tsx
<SocialButton provider="google" textStyle={{ fontFamily: googleSansFamily }} />
```

No render mode requires this font. For a bare React Native app without the Expo
plugin, copy
`node_modules/react-native-nitro-auth/assets/fonts/GoogleSans-Medium.ttf` to
Android as `android/app/src/main/assets/fonts/NitroAuthGoogleSans-Medium.ttf`.
On iOS, add `NitroAuthGoogleSans-Medium.ttf` to the app bundle and list it under
`UIAppFonts` in `Info.plist`. The registered font families are
`NitroAuthGoogleSans-Medium` on Android and `GoogleSans-Medium` on iOS; web apps
must register `GoogleSans-Medium` themselves. After changing native font
configuration, regenerate and rebuild the app.

The package ships the official Google and Apple marks as images and draws them
unaltered in every mode. The `svg` subpath uses vector button artwork; Google's
vector
export draws its mark with a Figma conic gradient inside a `foreignObject`,
which no native SVG renderer supports, so the package draws the mark image into
that box instead. Run `bun scripts/generate-social-button-assets.ts` after
changing any artwork file, then refresh `src/ui/assets/provenance.json`.

The layouts follow the [Google Sign-In branding
guidelines](https://developers.google.com/identity/branding-guidelines) and
[Apple's Sign in with Apple HIG](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple).

### Token semantics and capabilities

`expirationTime` is the access-token expiry in epoch milliseconds on every
platform. Android Google never returns an OAuth access token, so its
`expirationTime` uses the ID-token `exp` claim as a documented fallback and
`getAccessToken()` stays `undefined`.

Google `hostedDomain` is returned from the requested configuration. Android
keeps that non-secret value across module/process recreation only when the
restored Google account identity matches; logout or account replacement clears
it. iOS uses the restored Google account configuration, and web reports the
provider token claim when present.

Typed platform capabilities are exported so consumers never assume tokens the
provider cannot produce:

```ts
import { getProviderTokenCapabilities } from "react-native-nitro-auth";

const androidGoogle = getProviderTokenCapabilities("google", "android");
// { supportsAccessToken: false, accessTokenExpirySource: "id_token", ... }
```

| Provider  | Platform        | Access token | Client-side refresh | Server auth code | Expiry source  |
| --------- | --------------- | ------------ | ------------------- | ---------------- | -------------- |
| Google    | iOS             | yes          | yes                 | yes              | access token   |
| Google    | Android         | no           | yes (silent)        | yes (legacy)     | ID-token `exp` |
| Google    | Web             | yes          | yes                 | yes              | access token   |
| Apple     | iOS/Android/Web | no           | no                  | no               | —              |
| Microsoft | all             | yes          | yes                 | no               | access token   |

## Events

`onAuthEvent()` subscribes to privacy-safe typed lifecycle events:
`login_started`, `login_succeeded`, `login_failed`, `tokens_refreshed`,
`refresh_failed`, `session_changed`, `logout`, and `dispose`. Events carry the
provider and a typed error code only — never tokens or user payloads.

```ts
const unsubscribe = AuthService.onAuthEvent((event) => {
  if (event.type === "login_failed") {
    report(event.provider, event.errorCode);
  }
});

// Call when the subscriber is no longer needed.
unsubscribe();
```

Async service calls also emit `operation_started` followed by one
`operation_succeeded` or `operation_failed`. These events carry `operationId`,
`operation`, an optional `provider`, and terminal `elapsedMilliseconds`.
Failures include `errorCode`. Timing covers the complete service call, including
validation. Concurrent callers receive distinct IDs even when native refresh is
deduplicated. Use `AuthLifecycleEvent` for the full discriminated event union.
Synchronous logout/dispose retain their named lifecycle events.

`onAuthStateChanged`, `onTokensRefreshed`, and `onSessionChanged` can carry
credentials and profile data; never forward them to analytics. Listener failures
are isolated. Unsubscribe is idempotent and suppresses queued JS delivery.
Web legacy state registration sends an initial value; native registration waits
for a change. Use `getSessionSnapshot()` for an atomic current value:

```ts
const snapshot = AuthService.getSessionSnapshot(); // { revision, user?, scopes }
const remove = AuthService.onSessionChanged((next) => {
  // Consume the snapshot; do not log user or token fields.
});
```

`useAuth()` shares one native snapshot subscription across mounted consumers.
Snapshot observers remain usable after service disposal and reattach when the
service recreates. Other subscriptions end on disposal. Refresh publishes state,
then token data, then its named lifecycle event. Do not infer ordering between
async native callbacks and the service promise's operation events.

## Storage and Security

Native token fields, including Microsoft refresh tokens, are held in memory by
this package. Provider SDKs may retain their own sign-in state, which
`silentRestore()` can use. Persist only the minimum application session data
you need, preferably in platform secure storage or on your backend.

On web, user metadata and scopes use `sessionStorage` by default. Choose
`local`, `session`, or `memory` with `nitroAuthWebStorage`. Token fields and the
Microsoft refresh token remain in memory unless `nitroAuthPersistTokensOnWeb`
is `true` (default `false`). Enabling persistence places credentials in the
configured storage and changes your XSS risk profile.
Profile metadata (email, name, photo) is persisted by default; set
`nitroAuthPersistProfileOnWeb: false` to keep profile PII out of storage.

Restoring a cached session rewrites the owned cache record to remove token or
profile fields disallowed by the current policy. If the browser denies
writes/removals, the in-memory session stays sanitized, but physical
erasure cannot be guaranteed. Restricted browser storage falls back to memory.

Apple web SDK loading has a 15-second timeout. A later sign-in attempt retries
a failed load; package-owned failed scripts are removed, while scripts supplied
by the app remain owned by the app. Cancelled or disposed attempts cannot start
sign-in after a late SDK load.

JWT decoding in this package is for display and routing only. Native iOS and
Android share a C++ payload split ([native libraries](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/docs/native-libraries.md)). Validate token
signatures, issuer, audience, nonce, and expiry on your server before creating
an application session.

## Error Contract

`AuthService` operations and `useAuth()` mutations throw `AuthError` with
`name`, stable `code`, `operation`, `message`, and optional
`underlyingMessage`. `message` equals `code`; `operation` names the failed
phase; `underlyingMessage` preserves a differing raw platform message. The
full canonical OAuth error table and lifecycle contracts live in
[docs/error-contract.md](docs/error-contract.md).

```ts
import {
  AuthError,
  AuthService,
  type AuthErrorCode,
  type AuthOperation,
} from "react-native-nitro-auth";

async function signIn(
  reportFailure: (
    code: AuthErrorCode,
    operation: AuthOperation | undefined,
  ) => void,
) {
  try {
    await AuthService.login("google");
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "cancelled") return;
      reportFailure(error.code, error.operation);
      return;
    }
    throw error;
  }
}
```

Error codes are `cancelled`, `interaction_required`, `timeout`,
`popup_blocked`, `network_error`, `configuration_error`, `not_signed_in`,
`operation_in_progress`, `unsupported_provider`, `invalid_state`,
`invalid_nonce`, `token_error`, `no_id_token`, `parse_error`,
`refresh_failed`, and `unknown`.

Treat `underlyingMessage` as untrusted diagnostic text that may contain provider
details. Prefer `code` and `operation` for telemetry and user-facing decisions;
do not forward raw details automatically.

## Platform Support

| Platform | Status                                                            |
| -------- | ----------------------------------------------------------------- |
| iOS      | Google, Apple, Microsoft native flows.                            |
| Android  | Google and Microsoft native flows; Apple through an HTTPS broker. |
| Web      | Google, Apple, and Microsoft OAuth through Expo web config.       |
| Expo     | Development builds with the config plugin.                        |

The native package gate and Expo example use React Native `0.86.3`. The
`check:ci` workflow also compiles the public source against React Native
`0.87.0`'s Strict TypeScript API to catch declaration and callback regressions;
that compatibility check does not change the runtime baseline. Expo SDK
`57.0.26` selects React Native `0.86.3`; do not override it in an Expo app.

Package peer ranges: `react-native >=0.76.0`, `react-native-nitro-modules

> =0.37.0 <0.38.0`, and optional `expo >=52.0.0`, `expo-constants`, and
`react-native-svg >=15.8.0`.

### Migrating to 0.13

- `react-native-svg` is now an optional peer dependency. Apps that render SVG
  button artwork must install it and import from
  `react-native-nitro-auth/official-buttons/svg`:

  ```diff
  - import { OfficialSocialButton } from "react-native-nitro-auth/official-buttons";
  - <OfficialSocialButton provider="apple" renderMode="svg" />
  + import { OfficialSocialButton } from "react-native-nitro-auth/official-buttons/svg";
  + <OfficialSocialButton provider="apple" renderMode="svg" />
  ```

  `react-native-nitro-auth/official-buttons` now accepts only
  `renderMode="image"`.

- `expo-build-properties` is no longer installed with this package. Apps that
  configure it in `plugins` must list it in their own `dependencies`
  (`bunx expo install expo-build-properties`).
- The peer range is now `react-native >=0.76.0`. React Native `0.76` and Expo
  SDK `52` apps must set NDK `27` or later (see [Compatibility](#compatibility)).
- Native `refreshToken()` and near-expiry `getAccessToken()` reject with
  `operation_in_progress` while a login, scope request, or restore is pending.
  Catch that code and retry after the pending operation settles.
- Bare Android apps that use Microsoft login must add the
  `com.auth.MicrosoftAuthActivity` intent filter shown in
  [Microsoft redirect URIs](#microsoft-redirect-uris). The library manifest no
  longer declares a scheme-only `msauth` filter.
- On web, a provider error such as `invalid_grant` during login now maps to
  `token_error` (native already did); during refresh it maps to
  `refresh_failed`.

### Migrating to 0.12

Version 0.12.0 moves the official Google and Apple button artwork out of the
root entry. The root `SocialButton` supports only `renderMode="custom"`, and
TypeScript rejects `renderMode="image"` and `renderMode="svg"` on it. At runtime
the root button renders custom content for those values and logs a warning
in development builds.

Replace official-artwork buttons with `OfficialSocialButton` from the new
subpath:

```diff
- import { SocialButton } from "react-native-nitro-auth";
- <SocialButton provider="google" renderMode="image" />
+ import { OfficialSocialButton } from "react-native-nitro-auth/official-buttons";
+ <OfficialSocialButton provider="google" renderMode="image" />
```

Remove `customComponents`, `textStyle`, and `borderRadius` from those buttons;
official artwork never applied them. `SocialButtonRenderMode` is now `"custom"`;
use `OfficialSocialButtonRenderMode` from the subpath for `"image" | "svg"`.
Custom-mode buttons, `SocialProviderIcon`, `GoogleSocialButtonContent`, and
`AppleSocialButtonContent` need no change.

### Migration from 0.9.x and earlier

Version 0.10.0 requires Nitro Modules `>=0.37.0 <0.38.0`. Upgrade
`react-native-nitro-modules` before installing this package, then regenerate
native projects with `bunx expo prebuild` for Expo or run `pod install` for a
bare iOS app. Android callers that branch on `revokeAccess()` errors should
keep `unsupported_provider` for active One-Tap sessions and reserve
`not_signed_in` for an absent session.

## Troubleshooting

- **Expo Go error:** build a dev client; Expo Go cannot load Nitro modules.
- **Provider not configured:** verify plugin values, `expo.extra`, and that you
  prebuilt after changing config.
- **Apple profile missing name/email:** Apple only sends those fields on the
  first authorization.
- **Microsoft redirect mismatch:** register the URIs in [Microsoft redirect URIs](#microsoft-redirect-uris), and confirm bundle ID, Android package,
  `microsoftClientId`, and tenant/B2C settings match the provider console.

## Development

```sh
bun install
bun run check
bun run release:preflight
bun run example:prebuild
bun run example:android
bun run example:ios
```

Run native example builds locally before release when changing plugin, native,
Nitro, or packaging files. GitHub CI does not build the Android or iOS example;
use the commands above for local validation.

The [native performance investigation](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/docs/native-performance-plan.md) maps
current C++ ownership and implemented credential, event, error, and snapshot
improvements. It describes future work, not new APIs or measured speedups.

## Links

- [npm package](https://www.npmjs.com/package/react-native-nitro-auth)
- [GitHub repository](https://github.com/JoaoPauloCMarra/react-native-nitro-auth)
- [Issue tracker](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/issues)
- [Native libraries](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/docs/native-libraries.md)
- [Benchmark policy](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/docs/benchmarks.md)
- [Changelog](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/CHANGELOG.md)

## License

MIT

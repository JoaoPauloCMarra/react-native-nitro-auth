# react-native-nitro-auth

[![npm version](https://img.shields.io/npm/v/react-native-nitro-auth?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-auth)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-auth?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-auth)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-auth?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-0.86.2-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057%20%28RN%200.86.2%29-000020)](https://docs.expo.dev/versions/v57.0.0/)
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

## Requirements

| Dependency                 | Supported range or validated baseline                                              |
| -------------------------- | ---------------------------------------------------------------------------------- |
| React Native               | `>=0.75.0`; runtime gate `0.86.2`, RN `0.87` Strict TypeScript compatibility check |
| React                      | Validated with `19.2.3`                                                            |
| React Native Nitro Modules | `>=0.37.0 <0.38.0`                                                                 |
| Expo                       | SDK `57.0.16` development builds; RN `0.86.2`                                      |
| iOS                        | `16.4` or later                                                                    |

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

| Option                       | Platform | Required for                                                                     |
| ---------------------------- | -------- | -------------------------------------------------------------------------------- |
| `ios.googleClientId`         | iOS      | Google Sign-In on iOS.                                                           |
| `ios.googleServerClientId`   | iOS      | Google server auth code flow.                                                    |
| `ios.googleUrlScheme`        | iOS      | Optional Google redirect scheme. Derived from `ios.googleClientId` when omitted. |
| `ios.appleSignIn`            | iOS      | Apple Sign-In entitlement.                                                       |
| `ios.microsoftClientId`      | iOS      | Microsoft Entra ID native login.                                                 |
| `ios.microsoftTenant`        | iOS      | Microsoft tenant override.                                                       |
| `ios.microsoftB2cDomain`     | iOS      | Microsoft B2C hostname.                                                          |
| `android.googleClientId`     | Android  | Google Sign-In on Android.                                                       |
| `android.microsoftClientId`  | Android  | Microsoft Entra ID native login.                                                 |
| `android.microsoftTenant`    | Android  | Microsoft tenant override.                                                       |
| `android.microsoftB2cDomain` | Android  | Microsoft B2C hostname.                                                          |

When `ios.googleUrlScheme` is omitted, the plugin derives
`com.googleusercontent.apps.<id>` from an iOS client ID that ends in
`.apps.googleusercontent.com`. Set `ios.googleUrlScheme` only to override that
value.

Web reads provider client IDs from `expo.extra`; native platforms read values
written by the plugin during prebuild.

Web options in `expo.extra`:

| Option                         | Default           | Purpose                                                                         |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------- |
| `googleWebClientId`            | —                 | Google OAuth client ID.                                                         |
| `appleWebClientId`             | —                 | Apple Services ID.                                                              |
| `microsoftClientId`            | —                 | Microsoft Entra ID application ID.                                              |
| `microsoftTenant`              | `common`          | Microsoft tenant, domain, or B2C policy.                                        |
| `microsoftB2cDomain`           | —                 | Microsoft B2C hostname.                                                         |
| `nitroAuthWebStorage`          | `session`         | `session`, `local`, or `memory`.                                                |
| `nitroAuthPersistTokensOnWeb`  | adapter-dependent | Persist token fields in configured storage. Set explicitly in new integrations. |
| `nitroAuthPersistProfileOnWeb` | `true`            | Persist email/name/photo in configured storage.                                 |

Web reads `expo-constants` for these options. `expo-constants` is an optional
peer dependency: without it, web falls back to defaults and provider client
IDs must be configured another way.

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
`RecaptchaInterop`). Expo apps should not add those pods manually through
`expo-build-properties`.

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
`AuthService.currentUser`. `loginAndGetUser()` runs the same native login, then
returns that user or rejects with `not_signed_in`. `logout()` is synchronous and
returns `void`.

## Providers

| Provider  | Native       | Web | Notes                                                                 |
| --------- | ------------ | --- | --------------------------------------------------------------------- |
| Google    | iOS, Android | Yes | Supports account picker, login hint, refresh, and incremental scopes. |
| Apple     | iOS          | Yes | Returns name and email only on first authorization.                   |
| Microsoft | iOS, Android | Yes | Supports tenant, B2C, refresh, and incremental scopes.                |

Apple Sign-In is unavailable on Android. Use `expo-auth-session`,
`react-native-app-auth`, Auth0, Firebase Auth, or your identity provider SDK
when you need generic OAuth/OIDC providers, password authentication, MFA,
hosted user management, or server session management.

## API

Main exports:

- `useAuth()` for reactive user, scope, loading, and error state.
- `AuthService` for imperative operations and account listeners.
- `AuthService.loginAndGetUser()` when the caller needs the signed-in user from
  the same call.
- `SocialButton` for provider-aware UI.
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
- `refreshToken()` supports Google and Microsoft. Apple token exchange and
  refresh belong on your backend.
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

| Provider  | Platform | Access token | Client-side refresh | Server auth code | Expiry source  |
| --------- | -------- | ------------ | ------------------- | ---------------- | -------------- |
| Google    | iOS      | yes          | yes                 | yes              | access token   |
| Google    | Android  | no           | yes (silent)        | yes (legacy)     | ID-token `exp` |
| Google    | Web      | yes          | yes                 | yes              | access token   |
| Apple     | iOS/Web  | no           | no                  | no               | —              |
| Microsoft | all      | yes          | yes                 | no               | access token   |

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
```

## Storage and Security

Native token fields, including Microsoft refresh tokens, are held in memory by
this package. Provider SDKs may retain their own sign-in state, which
`silentRestore()` can use. Persist only the minimum application session data
you need, preferably in platform secure storage or on your backend.

On web, user metadata and scopes use `sessionStorage` by default. Choose
`local`, `session`, or `memory` with `nitroAuthWebStorage`. Token fields and the
Microsoft refresh token remain in memory unless token persistence is enabled.
Set `nitroAuthPersistTokensOnWeb` explicitly in new integrations. For backward
compatibility, a custom storage adapter still enables token persistence when
the option is omitted; set it to `false` to keep tokens in memory. Enabling
persistence places credentials in the configured storage and changes your XSS
risk profile.
Profile metadata (email, name, photo) is persisted by default; set
`nitroAuthPersistProfileOnWeb: false` to keep profile PII out of storage.
Supplying a custom storage adapter without an explicit token-persistence option
keeps the pre-0.7 behavior and persists tokens.

JWT decoding in this package is for display and routing only. Validate token
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
} from "react-native-nitro-auth";

async function signIn(
  reportFailure: (code: AuthErrorCode, detail: string | undefined) => void,
) {
  try {
    await AuthService.login("google");
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "cancelled") return;
      reportFailure(error.code, error.underlyingMessage);
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

## Platform Support

| Platform | Status                                                      |
| -------- | ----------------------------------------------------------- |
| iOS      | Google, Apple, Microsoft native flows.                      |
| Android  | Google and Microsoft native flows.                          |
| Web      | Google, Apple, and Microsoft OAuth through Expo web config. |
| Expo     | Development builds with the config plugin.                  |

The native package gate and Expo example use React Native `0.86.2`. The
`check:ci` workflow also compiles the public source against React Native
`0.87.0`'s Strict TypeScript API to catch declaration and callback regressions;
that compatibility check does not change the runtime baseline. Expo SDK
`57.0.16` selects React Native `0.86.2`; do not override it in an Expo app.

Package peer range: `>=0.37.0 <0.38.0`.

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
- **Microsoft redirect mismatch:** confirm bundle ID, Android package,
  `microsoftClientId`, and tenant/B2C settings match the provider console.

## Development

```sh
bun install
bun run check
bun run release:preflight
bun run example:android
bun run example:ios
```

Run native example builds locally before release when changing plugin, native,
Nitro, or packaging files. GitHub CI does not build the Android or iOS example;
use the commands above for local validation.

## Links

- [npm package](https://www.npmjs.com/package/react-native-nitro-auth)
- [GitHub repository](https://github.com/JoaoPauloCMarra/react-native-nitro-auth)
- [Issue tracker](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/issues)
- [Benchmark policy](docs/benchmarks.md)
- [Changelog](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/CHANGELOG.md)

## License

MIT

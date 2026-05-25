# react-native-nitro-auth

[![npm version](https://img.shields.io/npm/v/react-native-nitro-auth?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-auth)
[![license](https://img.shields.io/npm/l/react-native-nitro-auth?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-auth/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/expo-SDK%2056-000020)](https://expo.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.0-black)](https://nitro.margelo.com/)

Google Sign-In, Apple Sign-In, and Microsoft Entra ID for React Native and
Expo, powered by Nitro Modules.

Use it when you want one typed authentication API for native social login, web
OAuth, token refresh, incremental scopes, account listeners, and consistent
`AuthError` handling. The package keeps tokens in memory; your app decides what
to persist and where.

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
            googleUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME,
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

| Option                       | Platform | Required for                     |
| ---------------------------- | -------- | -------------------------------- |
| `ios.googleClientId`         | iOS      | Google Sign-In on iOS.           |
| `ios.googleServerClientId`   | iOS      | Google server auth code flow.    |
| `ios.googleUrlScheme`        | iOS      | Google redirect URL scheme.      |
| `ios.appleSignIn`            | iOS      | Apple Sign-In entitlement.       |
| `ios.microsoftClientId`      | iOS      | Microsoft Entra ID native login. |
| `ios.microsoftTenant`        | iOS      | Microsoft tenant override.       |
| `ios.microsoftB2cDomain`     | iOS      | Microsoft B2C authority.         |
| `android.googleClientId`     | Android  | Google Sign-In on Android.       |
| `android.microsoftClientId`  | Android  | Microsoft Entra ID native login. |
| `android.microsoftTenant`    | Android  | Microsoft tenant override.       |
| `android.microsoftB2cDomain` | Android  | Microsoft B2C authority.         |

Web reads provider client IDs from `expo.extra`; native platforms read values
written by the plugin during prebuild.

## Quick Start

```tsx
import { AuthService, AuthProvider, useAuth } from "react-native-nitro-auth";

export function SignInButton() {
  const { user, login, logout, loading, error } = useAuth();

  async function signInWithGoogle() {
    await login(AuthProvider.Google, {
      scopes: ["openid", "profile", "email"],
    });
  }

  if (user) {
    return <Button title="Sign out" onPress={logout} />;
  }

  return <Button title="Continue with Google" onPress={signInWithGoogle} />;
}

await AuthService.login(AuthProvider.Microsoft, {
  tenant: "organizations",
});
```

## Providers

| Provider  | Native       | Web | Notes                                                                 |
| --------- | ------------ | --- | --------------------------------------------------------------------- |
| Google    | iOS, Android | Yes | Supports account picker, login hint, refresh, and incremental scopes. |
| Apple     | iOS          | Yes | Apple returns name and email only on first authorization.             |
| Microsoft | iOS, Android | Yes | Supports tenant and B2C configuration.                                |

Use `expo-auth-session`, `react-native-app-auth`, Auth0, Firebase Auth, or your
identity provider SDK when you need a generic OAuth/OIDC provider, password
auth, MFA, hosted user management, or server session management.

## API

Main exports:

- `useAuth()` for React state, login, logout, refresh, and listeners.
- `AuthService` for imperative login, refresh, logout, and user reads.
- `SocialButton` for provider-aware UI.
- `AuthProvider` for Google, Apple, and Microsoft provider names.
- `AuthError` and `AuthErrorCode` for deterministic failures.
- Provider option types for strongly typed login calls.

Login options include `scopes`, `loginHint`, `accountId`, `forceRefresh`,
`nonce`, `state`, `tenant`, `prompt`, and provider-specific fields.

## Storage Model

Tokens are held in memory. Persist only the snapshot your app actually needs,
preferably in your own secure storage or backend session. JWT decode on the
client is for display and routing only; signature validation belongs on your
server.

## Error Contract

Async public APIs throw `AuthError` with a stable `code`, `provider`, `platform`,
and `message`. Use `instanceof AuthError` when branching in UI code.

Common codes include `cancelled`, `configuration_error`, `network_error`,
`provider_unavailable`, `token_refresh_failed`, and `unknown`.

## Platform Support

| Platform | Status                                                      |
| -------- | ----------------------------------------------------------- |
| iOS      | Google, Apple, Microsoft native flows.                      |
| Android  | Google and Microsoft native flows.                          |
| Web      | Google, Apple, and Microsoft OAuth through Expo web config. |
| Expo     | Development builds with the config plugin.                  |

Validated baseline: Expo SDK 56, React Native 0.85.3, React 19.2.3, and Nitro
Modules 0.35.7.

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

Run native example builds before release when changing plugin, native, Nitro, or
packaging files.

## License

MIT

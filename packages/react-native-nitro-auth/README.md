# react-native-nitro-auth

Fast React Native authentication for Google Sign-In, Apple Sign-In, and Microsoft Entra ID, built on Nitro Modules and JSI.

`react-native-nitro-auth` gives Expo and React Native apps one typed API for native social login, web OAuth, token refresh, incremental scopes, and auth state listeners without owning your app's long-term token storage.

## Why Use It?

- One package for Google, Apple, and Microsoft authentication on React Native.
- Native iOS and Android bridges powered by `react-native-nitro-modules`.
- Expo config plugin for client IDs, URL schemes, entitlements, and Android resources.
- Web implementation for Expo web with Google, Apple, and Microsoft OAuth.
- Typed `useAuth()` hook, `AuthService`, `SocialButton`, and `AuthError`.
- App-owned persistence model: tokens stay in memory unless your app stores a snapshot.
- Built-in flows for silent restore, token refresh, account picker, login hints, and incremental Google scopes.

## Choose Your Path

| Need | Use |
| --- | --- |
| Google, Apple, or Microsoft sign-in in an Expo or React Native app | `react-native-nitro-auth` |
| Generic OAuth or OIDC provider not covered by this package | `expo-auth-session` or `react-native-app-auth` |
| Firebase user management, password auth, MFA, and hosted auth platform | `@react-native-firebase/auth`, Auth0, Authgear, or your IDaaS SDK |
| Server-side session validation | Your backend; client JWT decode is display-only |

## Install

```sh
bun add react-native-nitro-auth react-native-nitro-modules
```

For Expo projects, prebuild after adding the config plugin:

```sh
bunx expo prebuild --clean
```

For bare React Native projects, install pods after installing the package:

```sh
cd ios && pod install
```

## Requirements

| Runtime | Requirement |
| --- | --- |
| React Native | `>=0.75` |
| Nitro Modules | `>=0.35` |
| iOS | 15.1+ recommended |
| Android | min SDK 24+ recommended |
| Expo example baseline | Expo SDK 55, React Native 0.83, React 19 |

## Expo Setup

Add the plugin to `app.json` or `app.config.js`.

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
      nitroAuthWebStorage: "memory",
      nitroAuthPersistTokensOnWeb: false,
    },
  },
};
```

### Plugin Options

| Option | Platform | Purpose |
| --- | --- | --- |
| `ios.googleClientId` | iOS | Google iOS OAuth client ID |
| `ios.googleServerClientId` | iOS | Google web/server client ID for server auth code flows |
| `ios.googleUrlScheme` | iOS | Reversed iOS client ID URL scheme |
| `ios.appleSignIn` | iOS | Adds Apple Sign-In entitlement when `true` |
| `ios.microsoftClientId` | iOS | Microsoft app/client ID |
| `ios.microsoftTenant` | iOS | Microsoft tenant, `common`, `organizations`, `consumers`, or tenant ID |
| `ios.microsoftB2cDomain` | iOS | Azure AD B2C domain |
| `android.googleClientId` | Android | Google web OAuth client ID |
| `android.microsoftClientId` | Android | Microsoft app/client ID |
| `android.microsoftTenant` | Android | Microsoft tenant |
| `android.microsoftB2cDomain` | Android | Azure AD B2C domain |

## Provider Setup

### Google Sign-In

Create OAuth clients in Google Cloud Console:

- iOS client ID for your bundle identifier.
- Web client ID for Android, web, and server auth code flows.
- Android SHA-1/SHA-256 entries for local debug and release signing.

Use the iOS reversed client ID as `GOOGLE_IOS_URL_SCHEME`.

### Apple Sign-In

Set `ios.appleSignIn: true` in the config plugin. Apple returns name and email only on the first authorization for a user. Store any profile fields you need in your own backend or app state.

Apple Sign-In is supported on iOS and web. It is intentionally reported as `unsupported_provider` on Android.

### Microsoft Entra ID

Create an app registration in Microsoft Entra ID and add redirect URIs:

- iOS: `msauth.<bundleIdentifier>://auth`
- Android: `msauth://<androidPackage>/<clientId>`
- Web: your web origin, for example `https://app.example.com`

Use `microsoftTenant` for `common`, `organizations`, `consumers`, a tenant ID, or a B2C policy path. Use `microsoftB2cDomain` for Azure AD B2C.

## Quick Start

```tsx
import { Button, Text, View } from "react-native";
import { AuthError, useAuth } from "react-native-nitro-auth";

export function SignInScreen() {
  const { user, loading, login, logout, getAccessToken } = useAuth();

  async function signInWithGoogle() {
    try {
      await login("google", {
        scopes: ["email", "profile"],
      });
    } catch (e) {
      const error = AuthError.from(e);
      console.warn(error.code, error.underlyingMessage);
    }
  }

  async function readToken() {
    const token = await getAccessToken();
    console.log(token);
  }

  return (
    <View>
      <Text>{user?.email ?? "Signed out"}</Text>
      <Button
        title={loading ? "Signing in..." : "Sign in with Google"}
        onPress={signInWithGoogle}
      />
      <Button title="Get access token" onPress={readToken} />
      <Button title="Sign out" onPress={logout} />
    </View>
  );
}
```

## SocialButton

```tsx
import { SocialButton } from "react-native-nitro-auth";

export function AuthButtons() {
  return (
    <>
      <SocialButton provider="google" />
      <SocialButton provider="apple" variant="black" />
      <SocialButton provider="microsoft" variant="outline" />
    </>
  );
}
```

## AuthService

Use `AuthService` when you need auth outside React components.

```ts
import { AuthService } from "react-native-nitro-auth";

await AuthService.silentRestore();

const unsubscribe = AuthService.onAuthStateChanged((user) => {
  console.log(user?.email);
});

const tokensUnsubscribe = AuthService.onTokensRefreshed((tokens) => {
  console.log(tokens.expirationTime);
});

unsubscribe();
tokensUnsubscribe();
```

## Login Options

```ts
await login("google", {
  scopes: ["email", "profile"],
  loginHint: "user@example.com",
  useOneTap: true,
  useSheet: true,
  forceAccountPicker: true,
  useLegacyGoogleSignIn: true,
});

await login("microsoft", {
  scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
  tenant: "organizations",
  prompt: "select_account",
});
```

| Option | Applies to | Notes |
| --- | --- | --- |
| `scopes` | Google, Microsoft | Requested OAuth scopes |
| `loginHint` | Google, Microsoft | Prefills account selection when supported |
| `useOneTap` | Android Google | Enables Credential Manager auto-select |
| `useSheet` | iOS Google | Uses native sign-in sheet behavior |
| `forceAccountPicker` | Google | Forces account picker |
| `useLegacyGoogleSignIn` | Android Google | Uses legacy Google Sign-In path for server auth code |
| `tenant` | Microsoft | Overrides configured tenant |
| `prompt` | Microsoft | `login`, `consent`, `select_account`, or `none` |

## Incremental Scopes

```ts
const calendarScope = "https://www.googleapis.com/auth/calendar.readonly";

await requestScopes([calendarScope]);
await revokeScopes([calendarScope]);
```

On Android, incremental Google scope requests use the legacy Google Sign-In APIs because Credential Manager does not expose an equivalent existing-account scope query.

## Storage Model

Native tokens are kept in memory by design. The package does not persist Microsoft refresh tokens or provider tokens to disk. Your app owns persistence and secure storage policy.

For app-managed persistence, store only the minimum state your product needs:

```ts
import { AuthService } from "react-native-nitro-auth";

const snapshot = {
  user: AuthService.currentUser,
  scopes: AuthService.grantedScopes,
  updatedAt: Date.now(),
};
```

On web, the default is also memory storage. You can opt into browser storage with:

```js
extra: {
  nitroAuthWebStorage: "session", // "session", "local", or "memory"
  nitroAuthPersistTokensOnWeb: true,
}
```

## Error Contract

All public async APIs throw `AuthError`.

```ts
try {
  await AuthService.login("microsoft");
} catch (e) {
  const error = AuthError.from(e);
  switch (error.code) {
    case "cancelled":
      break;
    case "configuration_error":
      break;
    case "token_error":
      break;
    default:
      break;
  }
}
```

Known error codes:

```ts
type AuthErrorCode =
  | "cancelled"
  | "timeout"
  | "popup_blocked"
  | "network_error"
  | "configuration_error"
  | "not_signed_in"
  | "operation_in_progress"
  | "unsupported_provider"
  | "invalid_state"
  | "invalid_nonce"
  | "token_error"
  | "no_id_token"
  | "parse_error"
  | "refresh_failed"
  | "unknown";
```

`underlyingMessage` keeps the raw native or OAuth message when it differs from the stable code.

## API Reference

### Exports

```ts
export * from "react-native-nitro-auth";
```

Main exports:

- `useAuth()`
- `AuthService`
- `SocialButton`
- `AuthError`
- `isAuthErrorCode()`
- `toAuthErrorCode()`
- `AuthProvider`
- `AuthUser`
- `AuthTokens`
- `LoginOptions`

### useAuth()

```ts
type UseAuthReturn = {
  user: AuthUser | undefined;
  scopes: string[];
  loading: boolean;
  error: AuthError | undefined;
  hasPlayServices: boolean;
  login(provider: AuthProvider, options?: LoginOptions): Promise<void>;
  logout(): void;
  requestScopes(scopes: string[]): Promise<void>;
  revokeScopes(scopes: string[]): Promise<void>;
  getAccessToken(): Promise<string | undefined>;
  refreshToken(): Promise<AuthTokens>;
  silentRestore(): Promise<void>;
};
```

### AuthUser

```ts
type AuthUser = {
  provider: "google" | "apple" | "microsoft";
  email?: string;
  name?: string;
  photo?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  serverAuthCode?: string;
  scopes?: string[];
  expirationTime?: number;
  underlyingError?: string;
};
```

## Example App

The example app is the fastest way to verify setup and read a complete integration.

```sh
cp apps/example/.env.example apps/example/.env.local
bun install
bun example:prebuild:clean
bun example:ios
bun example:android
```

The demo includes:

- Provider cards for Google, Apple, and Microsoft.
- Token and scope operations.
- Silent restore and account picker actions.
- App-owned disk snapshot example with `react-native-nitro-storage`.
- Runtime smoke tests for the public API.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `configuration_error` on Google | Client ID is missing or wrong for the current platform |
| Google works in debug but not release | Add release SHA-1/SHA-256 fingerprints to Google Cloud Console |
| Android `hasPlayServices` is false | Use an emulator image with Google Play Services |
| Apple email/name missing | Apple only returns these fields on first authorization |
| Microsoft `invalid_state` | Redirect URI or app resume path is wrong, or an old auth redirect completed late |
| Microsoft `token_error` | Check tenant, client ID, redirect URI, and requested scopes |
| Web popup blocked | Call `login()` from a user gesture such as a button press |
| `operation_in_progress` | A provider flow is already active; wait for it to finish or sign out |

## Production Notes

- Verify ID tokens on your backend. Client-side JWT parsing is for display and expiration hints only.
- Store refresh tokens only in storage your app explicitly owns and secures.
- Keep Google debug and release signing fingerprints in sync with your OAuth clients.
- Add provider-specific redirect URIs for every environment.
- Run the example app on iOS and Android before shipping provider config changes.

## Release Checks

```sh
bun run codegen
bun run build
bun run check
bun run test:cpp
bun example:prebuild:clean
bun example:ios
bun example:android
```

## License

MIT

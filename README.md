# react-native-nitro-auth

[![npm version](https://img.shields.io/npm/v/react-native-nitro-auth?style=flat-square)](https://www.npmjs.com/package/react-native-nitro-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Nitro Modules](https://img.shields.io/badge/Powered%20by-Nitro%20Modules-blueviolet?style=flat-square)](https://nitro.margelo.com)

🚀 **High-performance, JSI-powered Authentication for React Native.**

Nitro Auth is a modern authentication library for React Native built on top of [Nitro Modules](https://github.com/mrousavy/nitro). It provides a unified, type-safe API for Google, Apple, and Microsoft Sign-In with zero-bridge overhead.

## Why Nitro Auth?

Nitro Auth is designed to replace legacy modules like `@react-native-google-signin/google-signin` with a modern, high-performance architecture.

| Feature           | Legacy Modules               | Nitro Auth                                 |
| :---------------- | :--------------------------- | :----------------------------------------- |
| **Performance**   | Async bridge overhead (JSON) | **Direct JSI C++ (Zero-copy)**             |
| **Storage**       | Varies / Hidden defaults     | **In-memory only (app-owned persistence)** |
| **Setup**         | Manual async initialization  | **Sync & declarative plugins**             |
| **Types**         | Manual / Brittle             | **Fully Generated (Nitrogen)**             |
| **Provider Data** | Varies                       | **Normalized auth payload**                |

## Features

- **Ultra-fast**: Direct C++ calls using JSI (no JSON serialization).
- **Fully Type-Safe**: Shared types between TypeScript, C++, Swift, and Kotlin.
- **Incremental Auth**: Request additional OAuth scopes on the fly.
- **Expo Ready**: Comes with a powerful Config Plugin for zero-config setup.
- **Cross-Platform**: Unified API for iOS, Android, and Web.
- **Auto-Refresh**: Synchronous access to tokens with automatic silent refresh.
- **Google One-Tap / Sheet**: Modern login experience on Android (Credential Manager) and iOS (Sign-In Sheet).
- **Error Metadata**: Detailed native error messages for easier debugging.
- **Normalized Provider Payload**: Exposes provider/user/token fields in a consistent cross-platform shape.
- **App-Owned Persistence**: The package does not persist auth data. Apps decide what to persist and where.

## Design Philosophy

This is an **auth-only package** - it does NOT store any data on the device by default. The package provides:

- Login/logout functionality for Google, Apple, and Microsoft
- Token management (access token, refresh token, ID token)
- Scope management (request/revoke scopes)
- Consistent provider/user/token field exposure across iOS, Android, and Web

**Storage is the responsibility of the app using this package.** Use your own storage layer (for example [react-native-nitro-storage](https://github.com/JoaoPauloCMarra/react-native-nitro-storage)) to persist app-level auth snapshots/tokens when needed.

## Installation

```bash
bun add react-native-nitro-auth react-native-nitro-modules
```

For Expo projects, rebuild native code after installation:

```bash
bunx expo prebuild
```

### Testing locally (example app + Microsoft login)

Fastest way to confirm the package and Microsoft login work:

1. **Azure app (one-time)**  
   In [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**:
   - Name: e.g. `Nitro Auth Example`
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Redirect URI (add after creation):
     - **Android**: `msauth://com.auth.example/<client-id>`
     - **iOS**: `msauth.com.auth.example://auth` (use your bundle id)
   - Under **Authentication** → **Platform configurations** → add **Mobile and desktop applications** with the Android redirect URI above and the iOS one if testing on iOS.  
     Copy the **Application (client) ID**.

2. **Env file**  
   From the repo root:

   ```bash
   cd apps/example
   cp .env.example .env.local
   ```

   Edit `.env.local` and set at least:

   ```bash
   MICROSOFT_CLIENT_ID=<your-application-client-id>
   MICROSOFT_TENANT=common
   ```

   (Google/Apple can stay placeholder if you only care about Microsoft.)

3. **Run the app**  
   From the **monorepo root**:

   ```bash
   bun install
   bun run start
   ```

   In a second terminal:

   ```bash
   bun run example:android
   # or
   bun run example:ios
   ```

   Wait for the app to install and open.

4. **Test Microsoft**  
   In the app, tap **Sign in with Microsoft**. A browser or in-app tab opens; sign in with a Microsoft/personal account, then you should return to the app with the user shown (email, name, provider MICROSOFT).  
   If you see "configuration_error", check `MICROSOFT_CLIENT_ID` and that the redirect URI in Azure matches your app (e.g. `msauth://com.auth.example/<client-id>` for the example app).

> [!TIP]
> In the example app on Android, you can toggle **Legacy Google Sign-In** to compare Credential Manager vs legacy GoogleSignIn (and to get `serverAuthCode`).

### Expo Setup

Add the plugin to `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-nitro-auth",
        {
          "ios": {
            "googleClientId": "YOUR_IOS_CLIENT_ID.apps.googleusercontent.com",
            "googleServerClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
            "googleUrlScheme": "com.googleusercontent.apps.YOUR_IOS_CLIENT_ID",
            "appleSignIn": true,
            "microsoftClientId": "YOUR_AZURE_AD_CLIENT_ID",
            "microsoftTenant": "common",
            "microsoftB2cDomain": "your-tenant.b2clogin.com"
          },
          "android": {
            "googleClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
            "microsoftClientId": "YOUR_AZURE_AD_CLIENT_ID",
            "microsoftTenant": "common",
            "microsoftB2cDomain": "your-tenant.b2clogin.com"
          }
        }
      ]
    ],
    "extra": {
      "googleWebClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
      "microsoftClientId": "YOUR_AZURE_AD_CLIENT_ID",
      "microsoftTenant": "common",
      "microsoftB2cDomain": "your-tenant.b2clogin.com",
      "appleWebClientId": "com.example.web"
    }
  }
}
```

**Using environment variables (recommended):**

Create a `.env.local` file:

```bash
# iOS Client ID
GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.your-ios-client-id
GOOGLE_SERVER_CLIENT_ID=your-web-client-id.apps.googleusercontent.com

# Web Client ID (used for Android OAuth flow)
GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com

# Microsoft/Azure AD (optional)
MICROSOFT_CLIENT_ID=your-azure-ad-application-id
MICROSOFT_TENANT=common
MICROSOFT_B2C_DOMAIN=your-tenant.b2clogin.com

# Apple (web only)
APPLE_WEB_CLIENT_ID=com.example.web
```

Then reference them in `app.config.js`:

```javascript
import "dotenv/config";

export default {
  expo: {
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
      microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
      microsoftTenant: process.env.MICROSOFT_TENANT,
      microsoftB2cDomain: process.env.MICROSOFT_B2C_DOMAIN,
      appleWebClientId: process.env.APPLE_WEB_CLIENT_ID,
    },
  },
};
```

> [!NOTE]
>
> - `appleSignIn` on iOS is `false` by default to avoid unnecessary entitlements. Set it to `true` to enable Apple Sign-In.
> - For Android, use your **Web Client ID** (not Android Client ID) for proper OAuth flow.
> - If you need `serverAuthCode`, set `googleServerClientId` to your Web Client ID.
> - Add `googleWebClientId` to `expo.extra` for web platform support.
> - The `serverAuthCode` is automatically included in `AuthUser` when available (requires backend integration setup in Google Cloud Console).
> - For Microsoft Sign-In, use `common` tenant for multi-tenant apps, or specify your Azure AD tenant ID for single-tenant apps.
> - For Azure AD B2C, set `microsoftB2cDomain` and pass the B2C tenant in `microsoftTenant`.

### Google OAuth Setup

1. Create OAuth client IDs in Google Cloud Console:
   - **iOS client ID** (used by iOS)
   - **Web client ID** (used by Android and for `serverAuthCode`)
2. Configure your app:
   - Expo: set `googleClientId`, `googleServerClientId`, and `googleUrlScheme`
   - Bare iOS: add `GIDClientID`, `GIDServerClientID`, and URL scheme in `Info.plist`
   - Bare Android: set `nitro_auth_google_client_id` to your **Web client ID**
3. If you use `serverAuthCode`, make sure OAuth consent screen is configured in Google Cloud.

### Apple Sign-In Setup

1. **iOS**: enable the “Sign in with Apple” capability in Xcode and in your Apple Developer account.
2. **Web**: create a Service ID and configure the domain + return URL in Apple Developer.
3. Configure your app:
   - Expo: set `appleSignIn: true` for iOS.
   - Web: set `appleWebClientId` in `expo.extra` (or `.env`).

### Microsoft Azure AD Setup

To enable Microsoft Sign-In, you need to register an application in the Azure Portal:

1. Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
2. Click "New registration"
3. Set the redirect URIs:
   - **iOS**: `msauth.{bundle-identifier}://auth` (e.g., `msauth.com.myapp://auth`)
   - **Android**: `msauth://{package-name}/{client-id}` (e.g., `msauth://com.myapp/00000000-0000-0000-0000-000000000000`)
   - **Web**: `https://your-domain.com` (the page that loads the app)
4. Under "API permissions", add `openid`, `email`, `profile`, and `User.Read` (Microsoft Graph)
5. Copy the Application (client) ID for use in your config

**Tenant Options:**

- `common` - Any Azure AD or personal Microsoft account
- `organizations` - Any Azure AD account (work/school)
- `consumers` - Personal Microsoft accounts only
- `{tenant-id}` - Specific Azure AD tenant
- **B2C**: set `microsoftB2cDomain` (e.g. `your-tenant.b2clogin.com`) and use a tenant value like `your-tenant.onmicrosoft.com/B2C_1_signin` (or pass a full `https://.../` authority URL).

### Bare React Native

**iOS**

- Add to `Info.plist`: `GIDClientID`, `GIDServerClientID` (optional), `MSALClientID`, `MSALTenant` (optional), `MSALB2cDomain` (optional).
- Add URL schemes in `Info.plist`:
  - Google: `com.googleusercontent.apps.<YOUR_IOS_CLIENT_ID>`
  - Microsoft: `msauth.<your.bundle.id>` (used for `msauth.<bundle.id>://auth`)
- Enable the “Sign in with Apple” capability if you use Apple Sign-In.

**Android**

- Add string resources in `res/values/strings.xml`:
  - `nitro_auth_google_client_id` (Web client ID)
  - `nitro_auth_microsoft_client_id`
  - `nitro_auth_microsoft_tenant` (optional)
  - `nitro_auth_microsoft_b2c_domain` (optional)
- Add the Microsoft redirect activity to `AndroidManifest.xml`:

```xml
<activity
  android:name="com.auth.MicrosoftAuthActivity"
  android:exported="true">
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
      android:scheme="msauth"
      android:host="${applicationId}"
      android:path="/YOUR_MICROSOFT_CLIENT_ID" />
  </intent-filter>
</activity>
```

### Web Setup

Nitro Auth reads web configuration from `expo.extra`:

```json
{
  "expo": {
    "extra": {
      "googleWebClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
      "microsoftClientId": "YOUR_AZURE_AD_CLIENT_ID",
      "microsoftTenant": "common",
      "microsoftB2cDomain": "your-tenant.b2clogin.com",
      "appleWebClientId": "com.example.web",
      "nitroAuthWebStorage": "session",
      "nitroAuthPersistTokensOnWeb": false
    }
  }
}
```

For Apple web sign-in, `appleWebClientId` must be your Apple Service ID. For Microsoft web, make sure your Azure app includes a Web redirect URI matching your site.

- `nitroAuthWebStorage`: `"session"` (default), `"local"`, or `"memory"`.
- `nitroAuthPersistTokensOnWeb`: `false` by default (recommended). Set `true` only if you need cross-reload token persistence.

## Quick Start

### Using the Hook

```tsx
import { useAuth, SocialButton } from "react-native-nitro-auth";

function LoginScreen() {
  const { user, loading, error, login, logout, hasPlayServices } = useAuth();

  if (user) {
    return (
      <View>
        <Image source={{ uri: user.photo }} />
        <Text>{user.name}</Text>
        <Button title="Sign Out" onPress={logout} />
      </View>
    );
  }

  return (
    <View>
      {error && <Text style={{ color: "red" }}>{error.message}</Text>}
      {!hasPlayServices && <Text>Please install Google Play Services</Text>}

      <SocialButton
        provider="google"
        onPress={() => login("google")}
        disabled={loading || !hasPlayServices}
      />
      <SocialButton
        provider="apple"
        onPress={() => login("apple")}
        disabled={loading}
      />
      <SocialButton
        provider="microsoft"
        onPress={() => login("microsoft")}
        disabled={loading}
      />
    </View>
  );
}
```

### Microsoft Login Options

```tsx
// Login with specific tenant
await login("microsoft", {
  tenant: "your-tenant-id",
  prompt: "select_account", // 'login' | 'consent' | 'select_account' | 'none'
  scopes: ["openid", "email", "profile", "User.Read"],
  loginHint: "user@example.com",
});
```

**B2C example:**

```tsx
await login("microsoft", {
  tenant: "your-tenant.onmicrosoft.com/B2C_1_signin",
  scopes: ["openid", "email", "profile", "offline_access"],
});
```

## Migration from @react-native-google-signin/google-signin

If you are using `@react-native-google-signin/google-signin`, the migration to Nitro Auth is mostly a drop-in at the API level, but the setup is different because Nitro Auth uses a config plugin and JSI.

### 1) Replace the dependency

```bash
bun remove @react-native-google-signin/google-signin
bun add react-native-nitro-auth react-native-nitro-modules
```

### 2) Move configuration to the Nitro Auth plugin

Nitro Auth does not use `GoogleSignin.configure(...)`. Instead, set your client IDs via the config plugin (Expo) or native config (bare).

**Expo** (recommended):

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-nitro-auth",
        {
          "ios": {
            "googleClientId": "YOUR_IOS_CLIENT_ID.apps.googleusercontent.com",
            "googleUrlScheme": "com.googleusercontent.apps.YOUR_IOS_CLIENT_ID"
          },
          "android": {
            "googleClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
          }
        }
      ]
    ],
    "extra": {
      "googleWebClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
    }
  }
}
```

**Bare React Native:**

- iOS: add `GIDClientID` (and optionally `GIDServerClientID`) to `Info.plist` and set the URL scheme.
- Android: add `nitro_auth_google_client_id` string resource in `res/values/strings.xml` (use your Web Client ID).

### 3) Update API usage

| @react-native-google-signin/google-signin | Nitro Auth                                                |
| ----------------------------------------- | --------------------------------------------------------- |
| `GoogleSignin.configure({...})`           | Configure in plugin / native config                       |
| `GoogleSignin.signIn()`                   | `login("google")` or `<SocialButton provider="google" />` |
| `GoogleSignin.signOut()`                  | `logout()`                                                |
| `GoogleSignin.getTokens()`                | `getAccessToken()` or `refreshToken()`                    |
| `GoogleSignin.hasPlayServices()`          | `hasPlayServices` from `useAuth()`                        |

**Example migration:**

```tsx
// Before
import { GoogleSignin } from "@react-native-google-signin/google-signin";

await GoogleSignin.signIn();
const tokens = await GoogleSignin.getTokens();

// After
import { useAuth } from "react-native-nitro-auth";

const { login, getAccessToken } = useAuth();

await login("google");
const accessToken = await getAccessToken();
```

### 4) Remove manual init

If you previously called `GoogleSignin.configure()` at app startup, remove it. Nitro Auth loads configuration from the plugin/native settings at runtime.

## Advanced Features

### Silent Restore

Attempts to restore provider SDK sessions on app startup.

- Google: restore is supported via provider SDK session state.
- Apple: provider credentials are re-requested by OS flow.
- Microsoft: no internal persistence; restore requires your app/backend session strategy.

```tsx
useEffect(() => {
  AuthService.silentRestore();
}, []);
```

### Global Auth State Listener

Subscribe to authentication changes outside of React components:

```ts
import { AuthService } from "react-native-nitro-auth";

const unsubscribe = AuthService.onAuthStateChanged((user) => {
  if (user) {
    console.log("Logged in:", user.email);
  } else {
    console.log("Logged out");
  }
});

// Later...
unsubscribe();
```

### Global Token Refresh Listener

Be notified whenever tokens are refreshed automatically (or manually):

```ts
import { AuthService } from "react-native-nitro-auth";

const unsubscribe = AuthService.onTokensRefreshed((tokens) => {
  console.log("New tokens:", tokens.accessToken);
  // Update your API client / Apollo links
});
```

### Incremental Authorization

Request new scopes when you need them without logging the user out:

```tsx
const { requestScopes, revokeScopes, scopes } = useAuth();

const handleCalendar = async () => {
  try {
    await requestScopes(["https://www.googleapis.com/auth/calendar.readonly"]);
    console.log("Got calendar access!");
  } catch (e) {
    console.error("Scope request failed");
  }
};
```

### App-Owned Persistence

Nitro Auth is intentionally stateless in-process. Persist only what your app needs.

#### Using react-native-nitro-storage (Recommended)

```ts
import { AuthService, type AuthUser } from "react-native-nitro-auth";
import { createStorageItem, StorageScope } from "react-native-nitro-storage";

type AuthSnapshot = {
  user: AuthUser | undefined;
  scopes: string[];
  updatedAt: number | undefined;
};

const authSnapshotItem = createStorageItem<AuthSnapshot>({
  key: "auth_snapshot",
  scope: StorageScope.Disk,
  defaultValue: {
    user: undefined,
    scopes: [],
    updatedAt: undefined,
  },
});

// Save on auth changes (do not overwrite snapshot with empty user on app refresh)
AuthService.onAuthStateChanged((user) => {
  if (!user) return;

  authSnapshotItem.set({
    user,
    scopes: AuthService.grantedScopes,
    updatedAt: Date.now(),
  });
});

// Clear on logout
function logout() {
  AuthService.logout();
  authSnapshotItem.set({
    user: undefined,
    scopes: [],
    updatedAt: undefined,
  });
}
```

### Production Readiness

Nitro Auth is suitable for production use:

- **Google Sign-In**: Full support including One-Tap / Sheet, incremental scopes, and token refresh on iOS, Android, and Web.
- **Apple Sign-In**: Supported on iOS and Web (not available on Android).
- **Microsoft (Azure AD / B2C)**: Login, incremental scopes, and token refresh are supported on all platforms. Uses PKCE, state, and nonce for security.

**Token storage:** This package provides auth only and does not persist session data by default. Your app controls persistence strategy and security policy.

### Logging & Debugging

Enable verbose logging to see detailed OAuth flow information in the console:

```ts
import { AuthService } from "react-native-nitro-auth";

AuthService.setLoggingEnabled(true);
```

### Sync Access to Tokens

Nitro Auth provides synchronous access to the current state, while still supporting silent refresh:

```ts
// Quick access to what we have in memory
const user = AuthService.currentUser;
const scopes = AuthService.grantedScopes;

// Async access ensures fresh tokens (will refresh if expired)
const freshToken = await AuthService.getAccessToken();
```

### Standardized Error Codes

Handle failures reliably with predictable error strings. Some flows can surface provider-specific codes (listed below):

```ts
try {
  await login("google");
} catch (e) {
  const error = e as Error;
  if (error.message === "cancelled") {
    // User closed the popup/picker
  } else if (error.message === "network_error") {
    // Connection issues
  }
}
```

| Error Code             | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `cancelled`            | The user cancelled the sign-in flow            |
| `network_error`        | A network error occurred                       |
| `configuration_error`  | Missing client IDs or invalid setup            |
| `unsupported_provider` | The provider is not supported on this platform |
| `invalid_state`        | PKCE state mismatch (possible CSRF)            |
| `invalid_nonce`        | Nonce mismatch in token response               |
| `token_error`          | Token exchange failed                          |
| `no_id_token`          | No `id_token` in token response                |
| `parse_error`          | Failed to parse token response                 |
| `refresh_failed`       | Refresh token flow failed                      |
| `unknown`              | An unknown error occurred                      |

### Native Error Metadata

For more detailed debugging, Nitro Auth captures the raw native error message. You can access it from the authenticated user or cast the error:

```ts
// From authenticated user (on success)
const { user } = useAuth();
if (user?.underlyingError) {
  console.warn("Auth warning:", user.underlyingError);
}

// From error (on failure)
try {
  await login("google");
} catch (e) {
  const error = e as Error & { underlyingError?: string };
  console.log("Native error:", error.underlyingError);
}
```

### Troubleshooting

- `configuration_error`: verify client IDs, URL schemes, and redirect URIs are set for the current platform.
- `invalid_state` or `invalid_nonce`: ensure the redirect URI in your provider console matches your app config exactly.
- `hasPlayServices` is false: prompt the user to install/update Google Play Services or disable One-Tap.
- Apple web login fails: confirm `appleWebClientId` is set and your domain is registered with Apple.

### Automatic Token Refresh

The `getAccessToken()` method automatically checks if the current token is expired (or about to expire) and triggers a silent refresh if possible:

```ts
const { getAccessToken } = useAuth();

// This will silently refresh if needed!
const token = await getAccessToken();
```

### Offline Access (Server Auth Code)

If you need to access Google APIs from your backend (e.g., Google Calendar integration), you can use the `serverAuthCode`. This code is returned during login and can be exchanged for tokens on your server:

```ts
const { user } = useAuth();

if (user?.serverAuthCode) {
  // Send this to your backend!
  await api.verifyGoogleAccess(user.serverAuthCode);
}
```

### Google One-Tap & Sheet

Explicitly enable the modern One-Tap flow on Android or the Sign-In Sheet on iOS:

```ts
await login("google", {
  useOneTap: true, // Android
  useSheet: true, // iOS
});
```

> [!NOTE]
> One-Tap requires Google Play Services. You can check `hasPlayServices` from `useAuth()` and show a fallback UI if needed.

### Android Legacy Google Sign-In (Server Auth Code)

Credential Manager is the recommended default on Android, but it **does not return** `serverAuthCode`.
If your backend requires `serverAuthCode`, opt into the legacy flow:

```ts
await login("google", { useLegacyGoogleSignIn: true });
```

### Force Account Picker

When connecting additional services (like Google Calendar), you may want to let users pick a different account than the one they signed in with. Use `forceAccountPicker` to clear any cached session and show the account picker:

```ts
await login("google", {
  scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  forceAccountPicker: true, // Always show account picker
});
```

This is useful for scenarios where:

- Users want to connect a different Google account for calendar integration
- You need to ensure the user can select any account they've added to their device
- The cached session is interfering with the expected account selection UX

## API Reference

### Package Exports

```ts
import {
  AuthService,
  SocialButton,
  useAuth,
  type UseAuthReturn,
  type Auth,
  type AuthUser,
  type AuthTokens,
  type AuthProvider,
  type AuthErrorCode,
  type LoginOptions,
} from "react-native-nitro-auth";
```

### Core Types

| Type              | Definition                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthProvider`    | `"google" \| "apple" \| "microsoft"`                                                                                                                                                                                                          |
| `AuthErrorCode`   | `"cancelled" \| "timeout" \| "popup_blocked" \| "network_error" \| "configuration_error" \| "unsupported_provider" \| "invalid_state" \| "invalid_nonce" \| "token_error" \| "no_id_token" \| "parse_error" \| "refresh_failed" \| "unknown"` |
| `MicrosoftPrompt` | `"login" \| "consent" \| "select_account" \| "none"`                                                                                                                                                                                          |

### `AuthUser`

| Field             | Type                    | Description                                                                |
| ----------------- | ----------------------- | -------------------------------------------------------------------------- |
| `provider`        | `AuthProvider`          | Provider that authenticated the user                                       |
| `email`           | `string \| undefined`   | User email                                                                 |
| `name`            | `string \| undefined`   | Display name                                                               |
| `photo`           | `string \| undefined`   | Profile image URL (Google)                                                 |
| `idToken`         | `string \| undefined`   | OIDC ID token                                                              |
| `accessToken`     | `string \| undefined`   | OAuth access token                                                         |
| `refreshToken`    | `string \| undefined`   | OAuth refresh token                                                        |
| `serverAuthCode`  | `string \| undefined`   | Google server auth code (legacy Android flow + backend exchange scenarios) |
| `scopes`          | `string[] \| undefined` | Granted scopes for current session                                         |
| `expirationTime`  | `number \| undefined`   | Expiration timestamp in milliseconds since epoch                           |
| `underlyingError` | `string \| undefined`   | Raw provider/native error message                                          |

### `AuthTokens`

| Field            | Type                  | Description                   |
| ---------------- | --------------------- | ----------------------------- |
| `accessToken`    | `string \| undefined` | Refreshed access token        |
| `idToken`        | `string \| undefined` | Refreshed ID token            |
| `refreshToken`   | `string \| undefined` | Refresh token (if available)  |
| `expirationTime` | `number \| undefined` | Optional expiration timestamp |

### `LoginOptions`

| Option                  | Type              | Platform  | Description                                                                       |
| ----------------------- | ----------------- | --------- | --------------------------------------------------------------------------------- |
| `scopes`                | `string[]`        | All       | Requested scopes (defaults are provider-specific)                                 |
| `loginHint`             | `string`          | All       | Prefills account identifier                                                       |
| `useOneTap`             | `boolean`         | Android   | Use Credential Manager/One-Tap flow                                               |
| `useSheet`              | `boolean`         | iOS       | Use native Google Sign-In sheet                                                   |
| `forceAccountPicker`    | `boolean`         | All       | Always show account chooser                                                       |
| `useLegacyGoogleSignIn` | `boolean`         | Android   | Use legacy Google Sign-In (required when you need `serverAuthCode`)               |
| `tenant`                | `string`          | Microsoft | Tenant (`common`, `organizations`, `consumers`, tenant id, or full authority URL) |
| `prompt`                | `MicrosoftPrompt` | Microsoft | Prompt behavior                                                                   |

### `useAuth()`

```ts
declare function useAuth(): UseAuthReturn;
```

| Property          | Type                                                                | Description                                          |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| `user`            | `AuthUser \| undefined`                                             | Current in-memory user                               |
| `scopes`          | `string[]`                                                          | Current granted scopes                               |
| `loading`         | `boolean`                                                           | `true` while an auth operation is in-flight          |
| `error`           | `Error \| undefined`                                                | Last operation error                                 |
| `hasPlayServices` | `boolean`                                                           | Android Play Services availability                   |
| `login`           | `(provider: AuthProvider, options?: LoginOptions) => Promise<void>` | Starts provider login                                |
| `logout`          | `() => void`                                                        | Clears current session                               |
| `requestScopes`   | `(scopes: string[]) => Promise<void>`                               | Requests additional scopes                           |
| `revokeScopes`    | `(scopes: string[]) => Promise<void>`                               | Revokes scopes in current session                    |
| `getAccessToken`  | `() => Promise<string \| undefined>`                                | Returns access token, auto-refreshing when supported |
| `refreshToken`    | `() => Promise<AuthTokens>`                                         | Explicit refresh                                     |
| `silentRestore`   | `() => Promise<void>`                                               | Restores provider SDK session (if available)         |

### `AuthService`

Synchronous state + async operations (useful outside React trees).

#### Readonly state

| Property          | Type                    | Description                        |
| ----------------- | ----------------------- | ---------------------------------- |
| `name`            | `string`                | Hybrid object name (`"Auth"`)      |
| `currentUser`     | `AuthUser \| undefined` | Current user snapshot              |
| `grantedScopes`   | `string[]`              | Current scope snapshot             |
| `hasPlayServices` | `boolean`               | Android Play Services availability |

#### Methods

| Method               | Signature                                                | Description                      |
| -------------------- | -------------------------------------------------------- | -------------------------------- |
| `login`              | `(provider, options?) => Promise<void>`                  | Starts login                     |
| `logout`             | `() => void`                                             | Clears session                   |
| `requestScopes`      | `(scopes) => Promise<void>`                              | Incremental auth                 |
| `revokeScopes`       | `(scopes) => Promise<void>`                              | Scope revoke                     |
| `getAccessToken`     | `() => Promise<string \| undefined>`                     | Access token getter with refresh |
| `refreshToken`       | `() => Promise<AuthTokens>`                              | Explicit token refresh           |
| `silentRestore`      | `() => Promise<void>`                                    | Restore provider SDK session     |
| `onAuthStateChanged` | `(callback: (user?: AuthUser) => void) => () => void`    | Auth change listener             |
| `onTokensRefreshed`  | `(callback: (tokens: AuthTokens) => void) => () => void` | Token refresh listener           |
| `setLoggingEnabled`  | `(enabled: boolean) => void`                             | Debug logging toggle             |
| `dispose`            | `() => void`                                             | Disposes hybrid object           |
| `equals`             | `(other: unknown) => boolean`                            | Hybrid object identity check     |

### Storage Contract

Nitro Auth does not provide persistence APIs. Persist the auth data you need in your app layer (for example with `react-native-nitro-storage`, MMKV, Keychain wrappers, or backend-issued sessions).

### `SocialButton`

| Prop           | Type                                           | Default     | Description                                 |
| -------------- | ---------------------------------------------- | ----------- | ------------------------------------------- |
| `provider`     | `AuthProvider`                                 | required    | Provider                                    |
| `variant`      | `"primary" \| "outline" \| "white" \| "black"` | `"primary"` | Visual style                                |
| `borderRadius` | `number`                                       | `8`         | Border radius                               |
| `style`        | `ViewStyle`                                    | `undefined` | Container style override                    |
| `textStyle`    | `TextStyle`                                    | `undefined` | Text style override                         |
| `disabled`     | `boolean`                                      | `false`     | Disabled state                              |
| `onPress`      | `() => void`                                   | `undefined` | Custom press handler (skips built-in login) |
| `onSuccess`    | `(user: AuthUser) => void`                     | `undefined` | Called after successful default login       |
| `onError`      | `(error: unknown) => void`                     | `undefined` | Called when default login fails             |

### Config Plugin API (`app.json` / `app.config.js`)

`plugins: [["react-native-nitro-auth", { ios: {...}, android: {...} }]]`

#### iOS plugin options

| Option                 | Type      | Description                                  |
| ---------------------- | --------- | -------------------------------------------- |
| `googleClientId`       | `string`  | Writes `GIDClientID`                         |
| `googleServerClientId` | `string`  | Writes `GIDServerClientID`                   |
| `googleUrlScheme`      | `string`  | Adds Google URL scheme                       |
| `appleSignIn`          | `boolean` | Enables Apple Sign-In entitlement            |
| `microsoftClientId`    | `string`  | Writes `MSALClientID` + MSAL redirect scheme |
| `microsoftTenant`      | `string`  | Writes `MSALTenant`                          |
| `microsoftB2cDomain`   | `string`  | Writes `MSALB2cDomain`                       |

#### Android plugin options

| Option               | Type     | Description                                                      |
| -------------------- | -------- | ---------------------------------------------------------------- |
| `googleClientId`     | `string` | Writes `nitro_auth_google_client_id` string                      |
| `microsoftClientId`  | `string` | Writes `nitro_auth_microsoft_client_id` + redirect intent filter |
| `microsoftTenant`    | `string` | Writes `nitro_auth_microsoft_tenant`                             |
| `microsoftB2cDomain` | `string` | Writes `nitro_auth_microsoft_b2c_domain`                         |

### Web runtime config (`expo.extra`)

| Key                           | Type                               | Default     | Description                                               |
| ----------------------------- | ---------------------------------- | ----------- | --------------------------------------------------------- |
| `googleWebClientId`           | `string`                           | `undefined` | Google web OAuth client id                                |
| `microsoftClientId`           | `string`                           | `undefined` | Microsoft app client id                                   |
| `microsoftTenant`             | `string`                           | `"common"`  | Microsoft tenant/authority                                |
| `microsoftB2cDomain`          | `string`                           | `undefined` | B2C domain when applicable                                |
| `appleWebClientId`            | `string`                           | `undefined` | Apple Service ID                                          |
| `nitroAuthWebStorage`         | `"session" \| "local" \| "memory"` | `"session"` | Storage for non-sensitive web cache                       |
| `nitroAuthPersistTokensOnWeb` | `boolean`                          | `false`     | Persist sensitive tokens on web storage instead of memory |

### Error semantics

Errors are surfaced as `Error` with `message` as a normalized code when possible, and `underlyingError` with provider/native details.

| Normalized message    | Meaning                                        |
| --------------------- | ---------------------------------------------- |
| `cancelled`           | User cancelled popup/login flow                |
| `timeout`             | Provider popup did not complete before timeout |
| `popup_blocked`       | Browser blocked popup opening                  |
| `network_error`       | Network failure                                |
| `configuration_error` | Missing/invalid provider configuration         |

## Platform Support

| Feature                   | iOS | Android | Web |
| ------------------------- | --- | ------- | --- |
| Google Sign-In            | ✅  | ✅      | ✅  |
| Apple Sign-In             | ✅  | ❌      | ✅  |
| Microsoft Sign-In         | ✅  | ✅      | ✅  |
| Custom OAuth Scopes       | ✅  | ✅      | ✅  |
| Incremental Authorization | ✅  | ✅      | ✅  |
| Token Refresh             | ✅  | ✅      | ✅  |
| Session Persistence       | ✅  | ✅      | ✅  |
| Auto-Refresh              | ✅  | ✅      | ✅  |
| Native C++ Performance    | ✅  | ✅      | —   |

## Architecture

`react-native-nitro-auth` is built using [Nitro Modules](https://github.com/mrousavy/nitro). Unlike traditional React Native modules, Nitro uses JSI to provide:

- **Zero-bridge overhead**: Calls are made directly from JS to C++.
- **Type safety**: TypeScript types are automatically kept in sync with native C++ and Swift/Kotlin code.
- **Synchronous access**: Properties like `currentUser` are accessible synchronously without async overhead.

## License

MIT

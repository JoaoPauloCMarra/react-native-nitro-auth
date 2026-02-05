# react-native-nitro-auth

[![npm version](https://img.shields.io/npm/v/react-native-nitro-auth?style=flat-square)](https://www.npmjs.com/package/react-native-nitro-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Nitro Modules](https://img.shields.io/badge/Powered%20by-Nitro%20Modules-blueviolet?style=flat-square)](https://nitro.margelo.com)

🚀 **High-performance, JSI-powered Authentication for React Native.**

Nitro Auth is a modern authentication library for React Native built on top of [Nitro Modules](https://github.com/mrousavy/nitro). It provides a unified, type-safe API for Google, Apple, and Microsoft Sign-In with zero-bridge overhead.

## Why Nitro Auth?

Nitro Auth is designed to replace legacy modules like `@react-native-google-signin/google-signin` with a modern, high-performance architecture.

| Feature         | Legacy Modules               | Nitro Auth                     |
| :-------------- | :--------------------------- | :----------------------------- |
| **Performance** | Async bridge overhead (JSON) | **Direct JSI C++ (Zero-copy)** |
| **Persistence** | Varies / Manual              | **Built-in & Automatic**       |
| **Setup**       | Manual async initialization  | **Sync & declarative plugins** |
| **Types**       | Manual / Brittle             | **Fully Generated (Nitrogen)** |

## Features

- **Ultra-fast**: Direct C++ calls using JSI (no JSON serialization).
- **Fully Type-Safe**: Shared types between TypeScript, C++, Swift, and Kotlin.
- **Incremental Auth**: Request additional OAuth scopes on the fly.
- **Expo Ready**: Comes with a powerful Config Plugin for zero-config setup.
- **Cross-Platform**: Unified API for iOS, Android, and Web.
- **Auto-Refresh**: Synchronous access to tokens with automatic silent refresh.
- **Google One-Tap / Sheet**: Modern login experience on Android (Credential Manager) and iOS (Sign-In Sheet).
- **Error Metadata**: Detailed native error messages for easier debugging.
- **Custom Storage**: Pluggable storage adapters for secure persistence (e.g. Keychain, MMKV, AsyncStorage).
- **Refresh Interceptors**: Listen to token updates globally.

## Installation

```bash
bun add react-native-nitro-auth react-native-nitro-modules
# or
npm install react-native-nitro-auth react-native-nitro-modules
# or
yarn add react-native-nitro-auth react-native-nitro-modules
# or
pnpm add react-native-nitro-auth react-native-nitro-modules
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
      "appleWebClientId": "com.example.web"
    }
  }
}
```

For Apple web sign-in, `appleWebClientId` must be your Apple Service ID. For Microsoft web, make sure your Azure app includes a Web redirect URI matching your site.

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

Automatically restore the user session on app startup. This is faster than a full login and works offline if the session is cached.

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

### Pluggable Storage Adapters

Nitro Auth persists the session automatically. By default, it uses secure storage on native (Keychain on iOS, EncryptedSharedPreferences on Android) and `localStorage` on web.

#### 1) JS Storage (AsyncStorage, MMKV, etc.)

Easily swap the default storage with your preferred library from the JS layer:

```ts
import { AuthService, type JSStorageAdapter } from "react-native-nitro-auth";
import { MMKV } from "react-native-mmkv";

const storage = new MMKV();

const mmkvAdapter: JSStorageAdapter = {
  save: (key, value) => storage.set(key, value),
  load: (key) => storage.getString(key),
  remove: (key) => storage.delete(key),
};

// Set it once at app startup
AuthService.setJSStorageAdapter(mmkvAdapter);
```

> [!NOTE]
> Call `setJSStorageAdapter` before your first `useAuth()` or `AuthService` call so cached values are loaded before UI renders.

#### 2) Native Storage (Keychain, etc.)

For maximum security, you can implement a native HybridObject (C++, Swift, or Kotlin) and pass it to Nitro. This runs directly in memory at the C++ layer.

```ts
import { AuthService } from "react-native-nitro-auth";
// Import your native Nitro module
import { KeychainStorage } from "./native/KeychainStorage";

AuthService.setStorageAdapter(KeychainStorage);
```

**Production recommendation:** If you need custom storage policies, auditability, or a different encryption model, provide your own adapter (Keychain, EncryptedSharedPreferences, or a secure JS store). See [Pluggable Storage Adapters](#pluggable-storage-adapters) above.

### Production Readiness

Nitro Auth is suitable for production use:

- **Google Sign-In**: Full support including One-Tap / Sheet, incremental scopes, and token refresh on iOS, Android, and Web.
- **Apple Sign-In**: Supported on iOS and Web (not available on Android).
- **Microsoft (Azure AD / B2C)**: Login, incremental scopes, and token refresh are supported on all platforms. Uses PKCE, state, and nonce for security.

**Token storage:** By default, tokens are stored in secure platform storage on native (Keychain / EncryptedSharedPreferences) and in `localStorage` on web. On Android API < 23, storage falls back to unencrypted `SharedPreferences`. For high-security web requirements or custom storage needs, configure a [custom storage adapter](#pluggable-storage-adapters).

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

### Custom Storage Adapter

By default, Nitro Auth uses secure native storage on iOS/Android and `localStorage` on web. You can provide a custom adapter for different security or storage requirements.

> [!IMPORTANT]
> `AuthStorageAdapter` must be implemented as a **native Nitro HybridObject** in C++, Swift, or Kotlin. Plain JavaScript objects are not supported due to Nitro's type system. See [Nitro Hybrid Objects documentation](https://nitro.margelo.com/docs/hybrid-objects) for implementation details.

**Example (Swift):**

```swift
class HybridKeychainStorage: HybridAuthStorageAdapterSpec {
  func save(key: String, value: String) {
    // Save to Keychain
  }

  func load(key: String) -> String? {
    // Load from Keychain
  }

  func remove(key: String) {
    // Remove from Keychain
  }
}
```

**Usage (TypeScript):**

```ts
import { NitroModules } from "react-native-nitro-modules";
import { AuthService, AuthStorageAdapter } from "react-native-nitro-auth";

const keychainStorage =
  NitroModules.createHybridObject<AuthStorageAdapter>("KeychainStorage");
AuthService.setStorageAdapter(keychainStorage);
```

### Token Refresh Listeners

Perfect for updating your API client (e.g., Axios/Fetch) whenever tokens are refreshed in the background:

```ts
AuthService.onTokensRefreshed((tokens) => {
  console.log("Tokens were updated!", tokens.accessToken);
  apiClient.defaults.headers.common["Authorization"] =
    `Bearer ${tokens.accessToken}`;
});
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

### useAuth Hook

| Property          | Type                              | Description                                            |
| ----------------- | --------------------------------- | ------------------------------------------------------ |
| `user`            | `AuthUser \| undefined`           | Current authenticated user (includes `serverAuthCode`) |
| `scopes`          | `string[]`                        | Currently granted OAuth scopes                         |
| `loading`         | `boolean`                         | True during auth operations                            |
| `error`           | `Error \| undefined`              | Last error that occurred                               |
| `hasPlayServices` | `boolean`                         | (Android) True if Play Services available              |
| `login`           | `(provider, options?) => Promise` | Start login flow                                       |
| `logout`          | `() => void`                      | Clear session (synchronous)                            |
| `silentRestore`   | `() => Promise<void>`             | Restore session automatically on startup               |
| `requestScopes`   | `(scopes) => Promise`             | Request additional OAuth scopes                        |
| `revokeScopes`    | `(scopes) => Promise`             | Revoke previously granted scopes                       |
| `getAccessToken`  | `() => Promise<string?>`          | Get current access token (auto-refreshes)              |
| `refreshToken`    | `() => Promise<AuthTokens>`       | Explicitly refresh and return new tokens               |

### AuthService

| Method                     | Type                                      | Description                                        |
| -------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `login`                    | `(provider, options?) => Promise<void>`   | Start login flow                                   |
| `logout`                   | `() => void`                              | Clear session                                      |
| `silentRestore`            | `() => Promise<void>`                     | Restore session on startup                         |
| `requestScopes`            | `(scopes) => Promise<void>`               | Request additional OAuth scopes                    |
| `revokeScopes`             | `(scopes) => Promise<void>`               | Revoke previously granted scopes                   |
| `getAccessToken`           | `() => Promise<string \| undefined>`      | Get current access token (auto-refreshes)          |
| `refreshToken`             | `() => Promise<AuthTokens>`               | Explicitly refresh and return new tokens           |
| `onAuthStateChanged`       | `(callback) => () => void`                | Subscribe to auth state changes                    |
| `onTokensRefreshed`        | `(callback) => () => void`                | Subscribe to token refresh events                  |
| `setLoggingEnabled`        | `(enabled: boolean) => void`              | Enable or disable verbose logging                  |
| `setStorageAdapter`        | `(adapter?: AuthStorageAdapter) => void`  | Set native storage adapter                         |
| `setJSStorageAdapter`      | `(adapter?: JSStorageAdapter) => Promise<void>` | Set JS storage adapter                       |

### AuthUser

| Field            | Type                 | Description                                      |
| --------------- | -------------------- | ------------------------------------------------ |
| `provider`      | `"google" \| "apple" \| "microsoft"` | Provider that authenticated the user |
| `email`         | `string?`            | User email (if provided)                         |
| `name`          | `string?`            | User display name                                |
| `photo`         | `string?`            | Profile image URL (Google only)                  |
| `idToken`       | `string?`            | OIDC ID token                                    |
| `accessToken`   | `string?`            | Access token (if available)                      |
| `serverAuthCode`| `string?`            | Google server auth code (if configured)          |
| `scopes`        | `string[]?`          | Granted OAuth scopes                             |
| `expirationTime`| `number?`            | Token expiration time (ms since epoch)           |
| `underlyingError` | `string?`          | Raw native error message                         |

### LoginOptions

| Option               | Type       | Platform | Description                                     |
| -------------------- | ---------- | -------- | ----------------------------------------------- |
| `scopes`             | `string[]` | All      | Required OAuth scopes (default: email, profile) |
| `loginHint`          | `string`   | All      | Pre-fill email address in the login picker      |
| `useOneTap`          | `boolean`  | Android  | Enable Google One-Tap (Credential Manager)      |
| `useSheet`           | `boolean`  | iOS      | Enable iOS Google Sign-In Sheet                 |
| `forceAccountPicker` | `boolean`  | All      | Always show the account selection screen        |
| `useLegacyGoogleSignIn` | `boolean` | Android | Use legacy Google Sign-In (supports `serverAuthCode`) |
| `tenant`             | `string`   | Microsoft | Azure AD tenant (`common`, `organizations`, etc.) |
| `prompt`             | `string`   | Microsoft | Prompt behavior (`login`, `consent`, `select_account`, `none`) |

### SocialButton Props

| Prop           | Type                                           | Default     | Description                                   |
| -------------- | ---------------------------------------------- | ----------- | --------------------------------------------- |
| `provider`     | `"google" \| "apple" \| "microsoft"`           | required    | Authentication provider                       |
| `variant`      | `"primary" \| "outline" \| "white" \| "black"` | `"primary"` | Button style variant                          |
| `onPress`      | `() => void`                                   | —           | Custom handler (disables default login)       |
| `onSuccess`    | `(user: AuthUser) => void`                     | —           | Called with user data on success (auto-login) |
| `onError`      | `(error: unknown) => void`                     | —           | Called on failure (auto-login)                |
| `disabled`     | `boolean`                                      | `false`     | Disable button interaction                    |
| `style`        | `ViewStyle`                                    | —           | Custom container styles                       |
| `textStyle`    | `TextStyle`                                    | —           | Custom text styles                            |
| `borderRadius` | `number`                                       | `8`         | Button border radius                          |

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

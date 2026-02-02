# react-native-nitro-auth

[![npm version](https://img.shields.io/npm/v/react-native-nitro-auth?style=flat-square)](https://www.npmjs.com/package/react-native-nitro-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Nitro Modules](https://img.shields.io/badge/Powered%20by-Nitro%20Modules-blueviolet?style=flat-square)](https://nitro.margelo.com)

🚀 **High-performance, JSI-powered Authentication for React Native.**

Nitro Auth is a modern authentication library for React Native built on top of [Nitro Modules](https://github.com/mrousavy/nitro). It provides a unified, type-safe API for Google and Apple Sign-In with zero-bridge overhead.

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
            "googleUrlScheme": "com.googleusercontent.apps.YOUR_IOS_CLIENT_ID",
            "appleSignIn": true
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

**Using environment variables (recommended):**

Create a `.env.local` file:

```bash
# iOS Client ID
GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.your-ios-client-id

# Web Client ID (used for Android OAuth flow)
GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
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
            googleUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME,
            appleSignIn: true,
          },
          android: {
            googleClientId: process.env.GOOGLE_WEB_CLIENT_ID,
          },
        },
      ],
    ],
    extra: {
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
    },
  },
};
```

> [!NOTE]
>
> - `appleSignIn` on iOS is `false` by default to avoid unnecessary entitlements. Set it to `true` to enable Apple Sign-In.
> - For Android, use your **Web Client ID** (not Android Client ID) for proper OAuth flow.
> - Add `googleWebClientId` to `expo.extra` for web platform support.
> - The `serverAuthCode` is automatically included in `AuthUser` when available (requires backend integration setup in Google Cloud Console).

### Bare React Native

**iOS:** Add `GIDClientID` (and optionally `GIDServerClientID`) to `Info.plist` and enable "Sign in with Apple" capability.

**Android:** Add `nitro_auth_google_client_id` string resource in `res/values/strings.xml`.

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
    </View>
  );
}
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

Nitro Auth persists the session automatically. By default, it uses simple file-based storage on native and `localStorage` on web.

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

#### 2) Native Storage (Keychain, etc.)

For maximum security, you can implement a native HybridObject (C++, Swift, or Kotlin) and pass it to Nitro. This runs directly in memory at the C++ layer.

```ts
import { AuthService } from "react-native-nitro-auth";
// Import your native Nitro module
import { KeychainStorage } from "./native/KeychainStorage";

AuthService.setStorageAdapter(KeychainStorage);
```

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

Handle failures reliably with predictable error strings:

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

### Automatic Token Refresh

The `getAccessToken()` method automatically checks if the current token is expired (or about to expire) and triggers a silent refresh if possible:

```ts
const { getAccessToken } = useAuth();

// This will silently refresh if needed!
const token = await getAccessToken();
```

### Incremental Authorization

Add more scopes after initial login — no need to re-authenticate:

```tsx
const { requestScopes, revokeScopes, scopes } = useAuth();

// Request additional scope
await requestScopes(["https://www.googleapis.com/auth/calendar.readonly"]);

// Check granted scopes
console.log("Granted:", scopes);

// Revoke specific scopes
await revokeScopes(["https://www.googleapis.com/auth/calendar.readonly"]);
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

By default, Nitro Auth uses standard local storage. You can provide a custom adapter for better security.

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

### LoginOptions

| Option               | Type       | Platform | Description                                     |
| -------------------- | ---------- | -------- | ----------------------------------------------- |
| `scopes`             | `string[]` | All      | Required OAuth scopes (default: email, profile) |
| `loginHint`          | `string`   | All      | Pre-fill email address in the login picker      |
| `useOneTap`          | `boolean`  | Android  | Enable Google One-Tap (Credential Manager)      |
| `useSheet`           | `boolean`  | iOS      | Enable iOS Google Sign-In Sheet                 |
| `forceAccountPicker` | `boolean`  | All      | Always show the account selection screen        |
| `webClientId`        | `string`   | Web      | Override the default Google Web Client ID       |

### SocialButton Props

| Prop           | Type                                           | Default     | Description                                   |
| -------------- | ---------------------------------------------- | ----------- | --------------------------------------------- |
| `provider`     | `"google" \| "apple"`                          | required    | Authentication provider                       |
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

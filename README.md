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
- **Google One-Tap**: Modern login experience on Android using Credential Manager.
- **Custom Storage**: Pluggable storage adapters for secure persistence (e.g., Keychain).
- **Refresh Interceptors**: Listen to token updates globally.

## Installation

```bash
bun add react-native-nitro-auth react-native-nitro-modules
bun prebuild
```

### Expo Setup

Add the plugin to `app.json`:

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
            "googleUrlScheme": "com.googleusercontent.apps.YOUR_IOS_CLIENT_ID"
          },
          "android": {
            "googleClientId": "YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com"
          }
        }
      ]
    ]
  }
}
```

> [!NOTE] > `googleServerClientId` is only required if you need a `serverAuthCode` for backend integration.

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

## Advanced Features

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

### Standardized Error Codes

Handle failures reliably with predictable error strings:

```ts
try {
  await login("google");
} catch (e) {
  if (e.message === "cancelled") {
    // User closed the popup/picker
  } else if (e.message === "network_error") {
    // Connection issues
  }
}
```

| Code                   | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `cancelled`            | The user cancelled the sign-in flow            |
| `network_error`        | A network error occurred                       |
| `configuration_error`  | Missing client IDs or invalid setup            |
| `unsupported_provider` | The provider is not supported on this platform |

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

By default, Nitro Auth uses standard local storage. You can provide a custom adapter for better security (e.g., using `react-native-keychain`):

```ts
import { AuthService, AuthStorageAdapter } from "react-native-nitro-auth";

const myStorage: AuthStorageAdapter = {
  save: (key, value) => {
    /* Save to Keychain */
  },
  load: (key) => {
    /* Load from Keychain */
  },
  remove: (key) => {
    /* Clear from Keychain */
  },
};

AuthService.setStorageAdapter(myStorage);
```

### Token Refresh Listeners

Perfect for updating your API client (e.g., Axios/Fetch) whenever tokens are refreshed in the background:

```ts
AuthService.onTokensRefreshed((tokens) => {
  console.log("Tokens were updated!", tokens.accessToken);
  apiClient.defaults.headers.common[
    "Authorization"
  ] = `Bearer ${tokens.accessToken}`;
});
```

### Google One-Tap (Android)

Explicitly enable the modern One-Tap flow on Android:

```ts
await login("google", { useOneTap: true });
```

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
| `requestScopes`   | `(scopes) => Promise`             | Request additional OAuth scopes                        |
| `getAccessToken`  | `() => Promise<string?>`          | Get current access token (auto-refreshes)              |
| `refreshToken`    | `() => Promise<AuthTokens>`       | Explicitly refresh and return new tokens               |

### SocialButton Props

| Prop        | Type                                           | Default     | Description                      |
| ----------- | ---------------------------------------------- | ----------- | -------------------------------- |
| `provider`  | `"google" \| "apple"`                          | required    | Authentication provider          |
| `variant`   | `"primary" \| "outline" \| "white" \| "black"` | `"primary"` | Button style variant             |
| `onSuccess` | `(user: AuthUser) => void`                     | —           | Called with user data on success |
| `onError`   | `(error: Error) => void`                       | —           | Called on failure                |

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

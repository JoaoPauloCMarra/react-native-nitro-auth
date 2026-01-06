import "dotenv/config";

export default {
  expo: {
    name: "Nitro Auth Example",
    slug: "auth-example",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "auth",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.auth.example",
    },
    android: {
      package: "com.auth.example",
    },
    plugins: [
      "expo-router",
      "expo-build-properties",
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
      "expo-asset",
    ],
    extra: {
      // Web config - accessible via expo-constants
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
      appleWebClientId: process.env.APPLE_WEB_CLIENT_ID,
    },
    experiments: {
      typedRoutes: true,
    },
  },
};

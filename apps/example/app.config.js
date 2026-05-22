import "dotenv/config";

const appConfig = {
  expo: {
    name: "Nitro Auth",
    slug: "nitro-auth-example",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "auth",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.auth.example",
    },
    android: {
      package: "com.auth.example",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#100B2F",
      },
    },
    plugins: [
      "expo-router",
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
            buildToolsVersion: "36.0.0",
            usePrecompiledHeaders: true,
          },
          ios: {
            deploymentTarget: "16.4",
          },
        },
      ],
      "react-native-nitro-storage",
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
      "expo-asset",
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
    experiments: {
      typedRoutes: true,
    },
  },
};

export default appConfig;

import "dotenv/config";
import { spawnSync } from "node:child_process";

const hasCcache = () =>
  spawnSync("which", ["ccache"], { stdio: "ignore" }).status === 0;

const androidArchitectures = (process.env.NITRO_AUTH_ANDROID_ARCHS ?? "")
  .split(",")
  .map((arch) => arch.trim())
  .filter(Boolean);

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
      bundleIdentifier:
        process.env.NITRO_AUTH_IOS_BUNDLE_ID || "com.auth.example",
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
      "./plugins/with-gradle-build-speed",
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
            buildToolsVersion: "36.0.0",
            usePrecompiledHeaders: true,
            ...(androidArchitectures.length > 0
              ? { buildArchs: androidArchitectures }
              : {}),
          },
          ios: {
            deploymentTarget: "16.4",
            usePrecompiledModules: false,
            enableSceneSupport: true,
            ccacheEnabled:
              process.env.NITRO_AUTH_IOS_CCACHE !== "0" && hasCcache(),
          },
        },
      ],
      [
        "react-native-nitro-auth",
        {
          googleButtonFont: true,
          ios: {
            googleClientId: process.env.GOOGLE_IOS_CLIENT_ID,
            googleServerClientId: process.env.GOOGLE_SERVER_CLIENT_ID,
            googleUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME,
            appleSignIn: process.env.NITRO_AUTH_APPLE_SIGN_IN === "1",
            microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
            microsoftTenant: process.env.MICROSOFT_TENANT,
            microsoftB2cDomain: process.env.MICROSOFT_B2C_DOMAIN,
          },
          android: {
            googleClientId: process.env.GOOGLE_WEB_CLIENT_ID,
            appleAndroidBrokerUrl: process.env.APPLE_ANDROID_BROKER_URL,
            ...(process.env.APPLE_ANDROID_BROKER_URL
              ? { appleAndroidCallbackScheme: "nitro-auth-example" }
              : {}),
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
      reactCompiler: true,
      typedRoutes: true,
    },
  },
};

export default appConfig;

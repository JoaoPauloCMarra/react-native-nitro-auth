const { withBuildProperties } = require("expo-build-properties");
const {
  withInfoPlist,
  withEntitlementsPlist,
  withStringsXml,
  withAndroidManifest,
  AndroidConfig,
  createRunOncePlugin,
} = require("@expo/config-plugins");
const pkg = require("./package.json");

const googleSignInIosPods = [
  { name: "AppCheckCore", modular_headers: true },
  { name: "GoogleUtilities", modular_headers: true },
  { name: "RecaptchaInterop", modular_headers: true },
];

function getNitroAuthIosExtraPods(extraPods = []) {
  const pods = Array.isArray(extraPods) ? [...extraPods] : [];
  const existingPodNames = new Set(pods.map((pod) => pod?.name));

  for (const pod of googleSignInIosPods) {
    if (!existingPodNames.has(pod.name)) {
      pods.push(pod);
    }
  }

  return pods;
}

const GOOGLE_IOS_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";

function googleIosUrlSchemeFromClientId(clientId) {
  if (typeof clientId !== "string") {
    return undefined;
  }
  const trimmed = clientId.trim();
  if (!trimmed.endsWith(GOOGLE_IOS_CLIENT_ID_SUFFIX)) {
    return undefined;
  }
  const prefix = trimmed.slice(0, -GOOGLE_IOS_CLIENT_ID_SUFFIX.length);
  if (!prefix) {
    return undefined;
  }
  return `com.googleusercontent.apps.${prefix}`;
}

function resolveGoogleUrlScheme(ios = {}) {
  if (typeof ios.googleUrlScheme === "string") {
    const explicitScheme = ios.googleUrlScheme.trim();
    if (explicitScheme) {
      return explicitScheme;
    }
  }
  return googleIosUrlSchemeFromClientId(ios.googleClientId);
}

function resolveAppleAndroid(android) {
  const brokerUrl = android.appleAndroidBrokerUrl;
  const callbackScheme = android.appleAndroidCallbackScheme;
  if (!brokerUrl && !callbackScheme) {
    return undefined;
  }
  if (typeof brokerUrl !== "string" || typeof callbackScheme !== "string") {
    throw new Error(
      "Apple Android requires appleAndroidBrokerUrl and appleAndroidCallbackScheme.",
    );
  }
  let parsed;
  try {
    parsed = new URL(brokerUrl);
  } catch {
    throw new Error("Apple Android broker URL must be an absolute HTTPS URL.");
  }
  if (
    !/^https:\/\//i.test(brokerUrl) ||
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.port === "0" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    brokerUrl.includes("?") ||
    brokerUrl.includes("#") ||
    brokerUrl !== brokerUrl.trim() ||
    brokerUrl.includes("\\")
  ) {
    throw new Error(
      "Apple Android broker URL must use HTTPS without credentials, a query, or a fragment.",
    );
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(
      brokerUrl.replace(/^https:\/\/[^/]+/i, ""),
    );
  } catch {
    throw new Error(
      "Apple Android broker URL contains an invalid encoded path.",
    );
  }
  if (
    decodedPath.includes("\\") ||
    decodedPath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(
      "Apple Android broker URL must not contain relative path segments.",
    );
  }
  if (
    !/^[a-z][a-z0-9+.-]{0,63}$/.test(callbackScheme) ||
    [
      "http",
      "https",
      "javascript",
      "data",
      "file",
      "content",
      "intent",
      "about",
    ].includes(callbackScheme)
  ) {
    throw new Error(
      "Apple Android callback scheme must be a lowercase custom URL scheme.",
    );
  }
  return { brokerUrl: brokerUrl.replace(/\/+$/, ""), callbackScheme };
}

const withNitroAuth = (config, props = {}) => {
  const { ios = {}, android = {} } = props;
  const appleAndroid = resolveAppleAndroid(android);

  config = withBuildProperties(config, {
    ios: {
      extraPods: getNitroAuthIosExtraPods(config.ios?.extraPods),
    },
  });

  config = withInfoPlist(config, (config) => {
    if (ios.googleClientId) {
      config.modResults.GIDClientID = ios.googleClientId;
    }
    if (ios.googleServerClientId) {
      config.modResults.GIDServerClientID = ios.googleServerClientId;
    }
    const googleUrlScheme = resolveGoogleUrlScheme(ios);
    if (googleUrlScheme) {
      const existingSchemes = config.modResults.CFBundleURLTypes || [];
      if (
        !existingSchemes.some((scheme) =>
          scheme.CFBundleURLSchemes.includes(googleUrlScheme),
        )
      ) {
        config.modResults.CFBundleURLTypes = [
          ...existingSchemes,
          {
            CFBundleURLSchemes: [googleUrlScheme],
          },
        ];
      }
    }
    if (ios.microsoftClientId) {
      config.modResults.MSALClientID = ios.microsoftClientId;
      const msalScheme = `msauth.${config.ios?.bundleIdentifier}`;
      const existingSchemes = config.modResults.CFBundleURLTypes || [];
      if (
        !existingSchemes.some((scheme) =>
          scheme.CFBundleURLSchemes.includes(msalScheme),
        )
      ) {
        config.modResults.CFBundleURLTypes = [
          ...existingSchemes,
          {
            CFBundleURLSchemes: [msalScheme],
          },
        ];
      }
    }
    if (ios.microsoftTenant) {
      config.modResults.MSALTenant = ios.microsoftTenant;
    }
    if (ios.microsoftB2cDomain) {
      config.modResults.MSALB2cDomain = ios.microsoftB2cDomain;
    }
    return config;
  });

  if (ios.appleSignIn === true) {
    config = withEntitlementsPlist(config, (config) => {
      config.modResults["com.apple.developer.applesignin"] = ["Default"];
      return config;
    });
  }

  config = withStringsXml(config, (config) => {
    if (config.modResults.resources.string) {
      config.modResults.resources.string =
        config.modResults.resources.string.filter(
          (entry) =>
            ![
              "nitro_auth_apple_android_broker_url",
              "nitro_auth_apple_android_callback_scheme",
            ].includes(entry.$?.name),
        );
    }
    if (appleAndroid) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [
          {
            $: {
              name: "nitro_auth_apple_android_broker_url",
              translatable: "false",
              formatted: "false",
            },
            _: appleAndroid.brokerUrl,
          },
          {
            $: {
              name: "nitro_auth_apple_android_callback_scheme",
              translatable: "false",
            },
            _: appleAndroid.callbackScheme,
          },
        ],
        config.modResults,
      );
    }
    if (android.googleClientId) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [
          {
            $: { name: "nitro_auth_google_client_id" },
            _: android.googleClientId,
          },
        ],
        config.modResults,
      );
    }
    if (android.microsoftClientId) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [
          {
            $: { name: "nitro_auth_microsoft_client_id" },
            _: android.microsoftClientId,
          },
        ],
        config.modResults,
      );
    }
    if (android.microsoftTenant) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [
          {
            $: { name: "nitro_auth_microsoft_tenant" },
            _: android.microsoftTenant,
          },
        ],
        config.modResults,
      );
    }
    if (android.microsoftB2cDomain) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [
          {
            $: { name: "nitro_auth_microsoft_b2c_domain" },
            _: android.microsoftB2cDomain,
          },
        ],
        config.modResults,
      );
    }
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      if (!appleAndroid) {
        return config;
      }
      throw new Error(
        "Apple Android requires an application entry in AndroidManifest.xml.",
      );
    }
    application.activity = application.activity || [];
    if (!appleAndroid) {
      application.activity = application.activity.filter(
        (entry) =>
          entry.$?.["android:name"] !== "com.auth.AppleAuthCallbackActivity",
      );
      return config;
    }
    let activity = application.activity.find(
      (entry) =>
        entry.$?.["android:name"] === "com.auth.AppleAuthCallbackActivity",
    );
    if (!activity) {
      activity = {
        $: { "android:name": "com.auth.AppleAuthCallbackActivity" },
      };
      application.activity.push(activity);
    }
    activity.$["android:exported"] = "true";
    activity["intent-filter"] = [
      {
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
          { $: { "android:name": "android.intent.category.BROWSABLE" } },
        ],
        data: [
          {
            $: {
              "android:scheme": appleAndroid.callbackScheme,
              "android:host": "apple",
              "android:path": "/callback",
            },
          },
        ],
      },
    ];
    return config;
  });

  if (android.microsoftClientId) {
    config = withAndroidManifest(config, (config) => {
      const manifest = config.modResults.manifest;
      const application = manifest.application?.[0];
      const packageName =
        config.android?.package || AndroidConfig.Package.getPackageName(config);
      if (!packageName) {
        return config;
      }
      if (application) {
        application.activity = application.activity || [];
        const msalActivity = {
          $: {
            "android:name": "com.auth.MicrosoftAuthActivity",
            "android:exported": "true",
          },
          "intent-filter": [
            {
              action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
              category: [
                { $: { "android:name": "android.intent.category.DEFAULT" } },
                { $: { "android:name": "android.intent.category.BROWSABLE" } },
              ],
              data: [
                {
                  $: {
                    "android:scheme": "msauth",
                    "android:host": packageName,
                    "android:path": `/${android.microsoftClientId}`,
                  },
                },
              ],
            },
          ],
        };
        const existingMsalActivity = application.activity.find(
          (a) => a.$?.["android:name"] === "com.auth.MicrosoftAuthActivity",
        );
        if (!existingMsalActivity) {
          application.activity.push(msalActivity);
        }
      }
      return config;
    });
  }

  return config;
};

module.exports = createRunOncePlugin(withNitroAuth, pkg.name, pkg.version);
module.exports.withNitroAuth = withNitroAuth;
module.exports._internal = {
  getNitroAuthIosExtraPods,
  googleSignInIosPods,
  googleIosUrlSchemeFromClientId,
  resolveGoogleUrlScheme,
};

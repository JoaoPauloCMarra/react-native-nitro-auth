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

const withNitroAuth = (config, props = {}) => {
  const { ios = {}, android = {} } = props;

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
    if (ios.googleUrlScheme) {
      const existingSchemes = config.modResults.CFBundleURLTypes || [];
      if (
        !existingSchemes.some((scheme) =>
          scheme.CFBundleURLSchemes.includes(ios.googleUrlScheme),
        )
      ) {
        config.modResults.CFBundleURLTypes = [
          ...existingSchemes,
          {
            CFBundleURLSchemes: [ios.googleUrlScheme],
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
};

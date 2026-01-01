const {
  withInfoPlist,
  withEntitlementsPlist,
  withStringsXml,
  AndroidConfig,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const withNitroAuth = (config, props = {}) => {
  const { ios = {}, android = {} } = props;

  // 1. iOS Info.plist
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
          scheme.CFBundleURLSchemes.includes(ios.googleUrlScheme)
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
    return config;
  });

  // 2. iOS Entitlements
  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.applesignin"] = ["Default"];
    return config;
  });

  // 3. Android Strings (for Google Client ID)
  config = withStringsXml(config, (config) => {
    if (android.googleClientId) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [
          {
            $: { name: "nitro_auth_google_client_id" },
            _: android.googleClientId,
          },
        ],
        config.modResults
      );
    }
    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withNitroAuth,
  "react-native-nitro-auth",
  "0.1.3"
);

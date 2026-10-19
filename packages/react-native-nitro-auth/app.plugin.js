const fs = require("fs/promises");
const path = require("path");
const {
  withInfoPlist,
  withEntitlementsPlist,
  withStringsXml,
  withAndroidManifest,
  withDangerousMod,
  withXcodeProject,
  withPodfileProperties,
  IOSConfig,
  AndroidConfig,
  createRunOncePlugin,
} = require("expo/config-plugins");
const pkg = require("./package.json");
const PACKAGE_ROOT = path.dirname(require.resolve("./package.json"));

const GOOGLE_BUTTON_FONT_SOURCE = path.join(
  PACKAGE_ROOT,
  "assets",
  "fonts",
  "GoogleSans-Medium.ttf",
);
const GOOGLE_BUTTON_FONT_LICENSE_SOURCE = path.join(
  PACKAGE_ROOT,
  "assets",
  "fonts",
  "GoogleSans-OFL.txt",
);
const GOOGLE_BUTTON_FONT_ANDROID_PATH = path.join(
  "app",
  "src",
  "main",
  "assets",
  "fonts",
);
const GOOGLE_BUTTON_FONT_ANDROID_FILENAME = "NitroAuthGoogleSans-Medium.ttf";
const GOOGLE_BUTTON_FONT_ANDROID_LICENSE_FILENAME =
  "NitroAuthGoogleSans-OFL.txt";
const GOOGLE_BUTTON_FONT_IOS_FILENAME = GOOGLE_BUTTON_FONT_ANDROID_FILENAME;
const GOOGLE_BUTTON_FONT_IOS_LICENSE_FILENAME =
  GOOGLE_BUTTON_FONT_ANDROID_LICENSE_FILENAME;

const googleSignInIosPods = [
  { name: "AppCheckCore", modular_headers: true },
  { name: "GoogleUtilities", modular_headers: true },
  { name: "RecaptchaInterop", modular_headers: true },
];

const EXTRA_PODS_PROPERTY = "apple.extraPods";

function parseExtraPods(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      `${EXTRA_PODS_PROPERTY} in Podfile.properties.json must be a JSON array.`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${EXTRA_PODS_PROPERTY} in Podfile.properties.json must be a JSON array.`,
    );
  }
  return parsed;
}

function withGoogleSignInIosPods(config) {
  return withPodfileProperties(config, (config) => {
    const existing = parseExtraPods(config.modResults[EXTRA_PODS_PROPERTY]);
    const merged = getNitroAuthIosExtraPods(existing);
    if (merged.length !== existing.length) {
      config.modResults[EXTRA_PODS_PROPERTY] = JSON.stringify(merged);
    }
    return config;
  });
}

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

const ANDROID_STRING_OPTIONS = [
  ["nitro_auth_google_client_id", "googleClientId"],
  ["nitro_auth_microsoft_client_id", "microsoftClientId"],
  ["nitro_auth_microsoft_tenant", "microsoftTenant"],
  ["nitro_auth_microsoft_b2c_domain", "microsoftB2cDomain"],
];
const MANAGED_ANDROID_STRINGS = [
  "nitro_auth_apple_android_broker_url",
  "nitro_auth_apple_android_callback_scheme",
  ...ANDROID_STRING_OPTIONS.map(([name]) => name),
];
const APPLE_SIGN_IN_ENTITLEMENT = "com.apple.developer.applesignin";
const MANAGED_IOS_MARKER_KEY = "NitroAuthManaged";
const MICROSOFT_AUTH_ACTIVITY = "com.auth.MicrosoftAuthActivity";
// Manifest merge replaces the placeholder with the final applicationId, so
// applicationIdSuffix and product flavors keep a matching redirect host.
const ANDROID_APPLICATION_ID_PLACEHOLDER = "${applicationId}";

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

function resolveGoogleButtonFont(value) {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error("googleButtonFont must be a boolean.");
  }
  return value;
}

async function syncFontFile(source, destination, enabled) {
  if (enabled) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    return;
  }
  await fs.rm(destination, { force: true });
}

function withGoogleButtonFont(config, enabled) {
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const fontDirectory = path.join(
        config.modRequest.platformProjectRoot,
        GOOGLE_BUTTON_FONT_ANDROID_PATH,
      );
      await syncFontFile(
        GOOGLE_BUTTON_FONT_SOURCE,
        path.join(fontDirectory, GOOGLE_BUTTON_FONT_ANDROID_FILENAME),
        enabled,
      );
      await syncFontFile(
        GOOGLE_BUTTON_FONT_LICENSE_SOURCE,
        path.join(fontDirectory, GOOGLE_BUTTON_FONT_ANDROID_LICENSE_FILENAME),
        enabled,
      );
      return config;
    },
  ]);

  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const platformProjectRoot = config.modRequest.platformProjectRoot;
      await syncFontFile(
        GOOGLE_BUTTON_FONT_SOURCE,
        path.join(platformProjectRoot, GOOGLE_BUTTON_FONT_IOS_FILENAME),
        enabled,
      );
      await syncFontFile(
        GOOGLE_BUTTON_FONT_LICENSE_SOURCE,
        path.join(platformProjectRoot, GOOGLE_BUTTON_FONT_IOS_LICENSE_FILENAME),
        enabled,
      );
      return config;
    },
  ]);

  config = withInfoPlist(config, (config) => {
    const existingFonts = Array.isArray(config.modResults.UIAppFonts)
      ? config.modResults.UIAppFonts
      : [];
    if (enabled) {
      config.modResults.UIAppFonts = Array.from(
        new Set([...existingFonts, GOOGLE_BUTTON_FONT_IOS_FILENAME]),
      );
    } else {
      const remainingFonts = existingFonts.filter(
        (font) => font !== GOOGLE_BUTTON_FONT_IOS_FILENAME,
      );
      if (remainingFonts.length > 0) {
        config.modResults.UIAppFonts = remainingFonts;
      } else {
        delete config.modResults.UIAppFonts;
      }
    }
    return config;
  });

  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const resourceFiles = [
      GOOGLE_BUTTON_FONT_IOS_FILENAME,
      GOOGLE_BUTTON_FONT_IOS_LICENSE_FILENAME,
    ];
    if (enabled) {
      IOSConfig.XcodeUtils.ensureGroupRecursively(project, "Resources");
      for (const filepath of resourceFiles) {
        if (!project.hasFile(filepath)) {
          config.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
            filepath,
            groupName: "Resources",
            project: config.modResults,
            isBuildFile: true,
          });
        }
      }
    } else {
      const appTarget = project.getTarget("com.apple.product-type.application");
      if (appTarget) {
        for (const filepath of resourceFiles) {
          if (project.hasFile(filepath)) {
            project.removeResourceFile(filepath, { target: appTarget.uuid });
          }
        }
      }
    }
    return config;
  });

  return config;
}

function readManagedInfoPlist(plist) {
  const marker = plist[MANAGED_IOS_MARKER_KEY];
  const keys =
    marker && typeof marker.keys === "object" && marker.keys !== null
      ? marker.keys
      : {};
  const schemes = Array.isArray(marker?.schemes) ? marker.schemes : [];
  return { keys, schemes };
}

function removeManagedInfoPlist(plist, managed) {
  delete plist[MANAGED_IOS_MARKER_KEY];
  for (const [key, value] of Object.entries(managed.keys)) {
    if (plist[key] === value) delete plist[key];
  }
  if (managed.schemes.length === 0 || !Array.isArray(plist.CFBundleURLTypes)) {
    return;
  }
  const remainingUrlTypes = plist.CFBundleURLTypes.flatMap((urlType) => {
    const schemes = urlType.CFBundleURLSchemes ?? [];
    const keptSchemes = schemes.filter(
      (scheme) => !managed.schemes.includes(scheme),
    );
    if (keptSchemes.length === schemes.length) return [urlType];
    return keptSchemes.length > 0
      ? [{ ...urlType, CFBundleURLSchemes: keptSchemes }]
      : [];
  });
  if (remainingUrlTypes.length > 0) {
    plist.CFBundleURLTypes = remainingUrlTypes;
  } else {
    delete plist.CFBundleURLTypes;
  }
}

const PLUGIN_OPTION_KEYS = {
  ios: {
    googleClientId: "string",
    googleServerClientId: "string",
    googleUrlScheme: "string",
    appleSignIn: "boolean",
    microsoftClientId: "string",
    microsoftTenant: "string",
    microsoftB2cDomain: "string",
  },
  android: {
    googleClientId: "string",
    appleAndroidBrokerUrl: "string",
    appleAndroidCallbackScheme: "string",
    microsoftClientId: "string",
    microsoftTenant: "string",
    microsoftB2cDomain: "string",
  },
};

function assertPluginOptions(props) {
  const topLevelKeys = [...Object.keys(PLUGIN_OPTION_KEYS), "googleButtonFont"];
  for (const key of Object.keys(props)) {
    if (!topLevelKeys.includes(key)) {
      throw new Error(
        `Unknown react-native-nitro-auth plugin option "${key}". Expected one of: ${topLevelKeys.join(", ")}.`,
      );
    }
  }
  for (const [group, allowed] of Object.entries(PLUGIN_OPTION_KEYS)) {
    const options = props[group];
    if (options == null) continue;
    if (typeof options !== "object" || options === null) {
      throw new Error(
        `react-native-nitro-auth option "${group}" must be an object.`,
      );
    }
    for (const [key, value] of Object.entries(options)) {
      const expectedType = allowed[key];
      if (!expectedType) {
        throw new Error(
          `Unknown react-native-nitro-auth plugin option "${group}.${key}". Expected one of: ${Object.keys(allowed).join(", ")}.`,
        );
      }
      if (value != null && typeof value !== expectedType) {
        throw new Error(
          `react-native-nitro-auth option "${group}.${key}" must be a ${expectedType}.`,
        );
      }
    }
  }
}

const withNitroAuth = (config, props) => {
  props ??= {};
  assertPluginOptions(props);
  const ios = props.ios ?? {};
  const android = props.android ?? {};
  const appleAndroid = resolveAppleAndroid(android);
  const googleButtonFont = resolveGoogleButtonFont(props.googleButtonFont);

  config = withGoogleButtonFont(config, googleButtonFont);

  config = withGoogleSignInIosPods(config);

  config = withInfoPlist(config, (config) => {
    const plist = config.modResults;
    const previous = readManagedInfoPlist(plist);
    removeManagedInfoPlist(plist, previous);
    const written = { keys: {}, schemes: [] };
    const setKey = (key, value) => {
      if (plist[key] !== value) written.keys[key] = value;
      plist[key] = value;
    };
    const addScheme = (scheme) => {
      const existingSchemes = plist.CFBundleURLTypes || [];
      if (
        existingSchemes.some((urlType) =>
          (urlType.CFBundleURLSchemes ?? []).includes(scheme),
        )
      ) {
        return;
      }
      plist.CFBundleURLTypes = [
        ...existingSchemes,
        { CFBundleURLSchemes: [scheme] },
      ];
      written.schemes.push(scheme);
    };
    if (ios.googleClientId) {
      setKey("GIDClientID", ios.googleClientId);
    }
    if (ios.googleServerClientId) {
      setKey("GIDServerClientID", ios.googleServerClientId);
    }
    const googleUrlScheme = resolveGoogleUrlScheme(ios);
    if (googleUrlScheme) {
      addScheme(googleUrlScheme);
    } else if (ios.googleClientId) {
      // eslint-disable-next-line no-console
      console.warn(
        "[react-native-nitro-auth] ios.googleClientId does not end in .apps.googleusercontent.com, so no Google URL scheme was added. Set ios.googleUrlScheme or fix the client ID.",
      );
    }
    const bundleIdentifier = config.ios?.bundleIdentifier;
    if (ios.microsoftClientId && !bundleIdentifier) {
      // eslint-disable-next-line no-console
      console.warn(
        "[react-native-nitro-auth] Set ios.bundleIdentifier to register the Microsoft msauth.<bundleIdentifier> URL scheme.",
      );
    }
    if (ios.microsoftClientId) {
      setKey("MSALClientID", ios.microsoftClientId);
    }
    if (ios.microsoftClientId && bundleIdentifier) {
      addScheme(`msauth.${bundleIdentifier}`);
    }
    if (ios.microsoftTenant) {
      setKey("MSALTenant", ios.microsoftTenant);
    }
    if (ios.microsoftB2cDomain) {
      setKey("MSALB2cDomain", ios.microsoftB2cDomain);
    }
    if (Object.keys(written.keys).length > 0 || written.schemes.length > 0) {
      plist[MANAGED_IOS_MARKER_KEY] = written;
    }
    return config;
  });

  const userOwnsAppleEntitlement =
    config.ios?.usesAppleSignIn === true ||
    config.ios?.entitlements?.[APPLE_SIGN_IN_ENTITLEMENT] !== undefined;
  if (typeof ios.appleSignIn === "boolean") {
    config = withEntitlementsPlist(config, (config) => {
      if (ios.appleSignIn === true) {
        config.modResults[APPLE_SIGN_IN_ENTITLEMENT] = ["Default"];
      } else if (!userOwnsAppleEntitlement) {
        delete config.modResults[APPLE_SIGN_IN_ENTITLEMENT];
      }
      return config;
    });
  }

  config = withStringsXml(config, (config) => {
    if (config.modResults.resources.string) {
      config.modResults.resources.string =
        config.modResults.resources.string.filter(
          (entry) => !MANAGED_ANDROID_STRINGS.includes(entry.$?.name),
        );
    }
    const entries = [
      ...(appleAndroid
        ? [
            [
              "nitro_auth_apple_android_broker_url",
              appleAndroid.brokerUrl,
              { translatable: "false", formatted: "false" },
            ],
            [
              "nitro_auth_apple_android_callback_scheme",
              appleAndroid.callbackScheme,
              { translatable: "false" },
            ],
          ]
        : []),
      ...ANDROID_STRING_OPTIONS.flatMap(([name, option]) =>
        android[option] ? [[name, android[option], {}]] : [],
      ),
    ];
    for (const [name, value, attributes] of entries) {
      config.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name, ...attributes }, _: value }],
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

  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      return config;
    }
    application.activity = (application.activity || []).filter(
      (entry) => entry.$?.["android:name"] !== MICROSOFT_AUTH_ACTIVITY,
    );
    if (!android.microsoftClientId) {
      return config;
    }
    application.activity.push({
      $: {
        "android:name": MICROSOFT_AUTH_ACTIVITY,
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
                "android:host": ANDROID_APPLICATION_ID_PLACEHOLDER,
                "android:path": `/${android.microsoftClientId}`,
              },
            },
          ],
        },
      ],
    });
    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(withNitroAuth, pkg.name, pkg.version);
module.exports.withNitroAuth = withNitroAuth;
module.exports._internal = {
  getNitroAuthIosExtraPods,
  googleSignInIosPods,
  googleIosUrlSchemeFromClientId,
  resolveGoogleUrlScheme,
  resolveGoogleButtonFont,
};

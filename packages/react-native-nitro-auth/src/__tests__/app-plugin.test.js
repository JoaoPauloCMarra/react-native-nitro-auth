const { _internal, withNitroAuth } = require("../../app.plugin.js");

const appleAndroid = {
  appleAndroidBrokerUrl: "https://auth.example.com/apple/",
  appleAndroidCallbackScheme: "example-auth",
};

async function applyMod(platform, mod, modResults, android = appleAndroid) {
  const config = withNitroAuth(
    { name: "Example", slug: "example", android: { package: "com.example" } },
    { android, ios: { appleSignIn: true } },
  );
  const result = await config.mods[platform][mod]({
    ...config,
    modResults,
    modRequest: { platform, modName: mod, projectRoot: "/tmp/example" },
  });
  return result.modResults;
}

describe("Android Apple Expo configuration", () => {
  it.each([
    { ...appleAndroid, appleAndroidBrokerUrl: "https:auth.example.com" },
    { ...appleAndroid, appleAndroidBrokerUrl: "https://auth.example.com:0" },
    {
      ...appleAndroid,
      appleAndroidBrokerUrl: "https://auth.example.com/apple/../other",
    },
    {
      ...appleAndroid,
      appleAndroidBrokerUrl: "https://auth.example.com/apple/%2e%2e/other",
    },
    {
      ...appleAndroid,
      appleAndroidBrokerUrl: "https://auth.example.com/apple/%5cother",
    },
    { ...appleAndroid, appleAndroidCallbackScheme: "A".repeat(65) },
    { appleAndroidBrokerUrl: appleAndroid.appleAndroidBrokerUrl },
    { appleAndroidCallbackScheme: appleAndroid.appleAndroidCallbackScheme },
    { ...appleAndroid, appleAndroidBrokerUrl: "http://auth.example.com" },
    {
      ...appleAndroid,
      appleAndroidBrokerUrl: "https://user:pass@auth.example.com",
    },
    {
      ...appleAndroid,
      appleAndroidBrokerUrl: "https://auth.example.com/?key=x",
    },
    {
      ...appleAndroid,
      appleAndroidBrokerUrl: "https://auth.example.com/#fragment",
    },
    { ...appleAndroid, appleAndroidCallbackScheme: "https" },
    { ...appleAndroid, appleAndroidCallbackScheme: "example://callback" },
  ])("rejects invalid or incomplete settings: %j", (android) => {
    expect(() =>
      withNitroAuth({ name: "Example", slug: "example" }, { android }),
    ).toThrow(/Apple/);
  });

  it("allows Apple Android to remain unconfigured", () => {
    expect(() =>
      withNitroAuth(
        { name: "Example", slug: "example" },
        {
          android: { appleAndroidBrokerUrl: "" },
        },
      ),
    ).not.toThrow();
  });

  it("writes public settings while preserving Google and unrelated resources", async () => {
    const result = await applyMod(
      "android",
      "strings",
      {
        resources: { string: [{ $: { name: "app_name" }, _: "Example" }] },
      },
      { ...appleAndroid, googleClientId: "google-client" },
    );
    expect(result.resources.string).toEqual(
      expect.arrayContaining([
        { $: { name: "app_name" }, _: "Example" },
        { $: { name: "nitro_auth_google_client_id" }, _: "google-client" },
        {
          $: {
            name: "nitro_auth_apple_android_broker_url",
            translatable: "false",
            formatted: "false",
          },
          _: "https://auth.example.com/apple",
        },
        {
          $: {
            name: "nitro_auth_apple_android_callback_scheme",
            translatable: "false",
          },
          _: "example-auth",
        },
      ]),
    );
  });

  it("registers one exact callback and replaces its scheme on subsequent prebuilds", async () => {
    const mainActivity = { $: { "android:name": ".MainActivity" } };
    let manifest = {
      manifest: { application: [{ activity: [mainActivity] }] },
    };
    manifest = await applyMod("android", "manifest", manifest);
    manifest = await applyMod("android", "manifest", manifest, {
      ...appleAndroid,
      appleAndroidCallbackScheme: "updated-auth",
      microsoftClientId: "microsoft-client",
    });
    const activities = manifest.manifest.application[0].activity;
    expect(activities).toContainEqual(mainActivity);
    const callbacks = activities.filter(
      (a) => a.$["android:name"] === "com.auth.AppleAuthCallbackActivity",
    );
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].$["android:exported"]).toBe("true");
    expect(callbacks[0]["intent-filter"]).toEqual([
      {
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
          { $: { "android:name": "android.intent.category.BROWSABLE" } },
        ],
        data: [
          {
            $: {
              "android:scheme": "updated-auth",
              "android:host": "apple",
              "android:path": "/callback",
            },
          },
        ],
      },
    ]);
    expect(
      activities.some(
        (a) => a.$["android:name"] === "com.auth.MicrosoftAuthActivity",
      ),
    ).toBe(true);
  });

  it("preserves iOS Apple entitlement configuration", async () => {
    expect(await applyMod("ios", "entitlements", {})).toEqual({
      "com.apple.developer.applesignin": ["Default"],
    });
  });

  it("removes stale Apple configuration when disabled without removing Google", async () => {
    const enabled = { ...appleAndroid, googleClientId: "google-client" };
    let strings = await applyMod(
      "android",
      "strings",
      { resources: {} },
      enabled,
    );
    strings = await applyMod("android", "strings", strings, {});
    expect(strings.resources.string).toEqual([
      { $: { name: "nitro_auth_google_client_id" }, _: "google-client" },
    ]);
    const mainActivity = { $: { "android:name": ".MainActivity" } };
    let manifest = await applyMod("android", "manifest", {
      manifest: { application: [{ activity: [mainActivity] }] },
    });
    manifest = await applyMod("android", "manifest", manifest, {});
    expect(manifest.manifest.application[0].activity).toEqual([mainActivity]);
  });
});

describe("Expo config plugin", () => {
  it("adds modular header pods for the GoogleSignIn dependency chain", () => {
    expect(_internal.getNitroAuthIosExtraPods()).toEqual([
      { name: "AppCheckCore", modular_headers: true },
      { name: "GoogleUtilities", modular_headers: true },
      { name: "RecaptchaInterop", modular_headers: true },
    ]);
  });

  it("preserves existing pods and does not duplicate managed pods", () => {
    const extraPods = [
      { name: "ExistingPod", version: "1.0.0" },
      { name: "GoogleUtilities", modular_headers: true },
    ];

    expect(_internal.getNitroAuthIosExtraPods(extraPods)).toEqual([
      { name: "ExistingPod", version: "1.0.0" },
      { name: "GoogleUtilities", modular_headers: true },
      { name: "AppCheckCore", modular_headers: true },
      { name: "RecaptchaInterop", modular_headers: true },
    ]);
  });

  it("derives the iOS Google URL scheme from a reversed client id", () => {
    expect(
      _internal.googleIosUrlSchemeFromClientId(
        "123-abc.apps.googleusercontent.com",
      ),
    ).toBe("com.googleusercontent.apps.123-abc");
  });

  it("ignores client ids that are not reversed iOS Google ids", () => {
    expect(
      _internal.googleIosUrlSchemeFromClientId(
        "123-abc.apps.googleusercontent.com.example",
      ),
    ).toBeUndefined();
    expect(_internal.googleIosUrlSchemeFromClientId("")).toBeUndefined();
    expect(_internal.googleIosUrlSchemeFromClientId(undefined)).toBeUndefined();
  });

  it("prefers an explicit googleUrlScheme over the derived value", () => {
    expect(
      _internal.resolveGoogleUrlScheme({
        googleClientId: "123-abc.apps.googleusercontent.com",
        googleUrlScheme: "com.googleusercontent.apps.custom",
      }),
    ).toBe("com.googleusercontent.apps.custom");
  });

  it("derives googleUrlScheme when the explicit override is blank", () => {
    expect(
      _internal.resolveGoogleUrlScheme({
        googleClientId: "123-abc.apps.googleusercontent.com",
        googleUrlScheme: "  ",
      }),
    ).toBe("com.googleusercontent.apps.123-abc");
  });
});

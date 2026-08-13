const { _internal } = require("../../app.plugin.js");

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

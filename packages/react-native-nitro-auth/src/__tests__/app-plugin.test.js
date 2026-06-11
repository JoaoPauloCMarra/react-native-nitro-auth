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
});

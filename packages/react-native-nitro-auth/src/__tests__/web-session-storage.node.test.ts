/**
 * @jest-environment node
 */
import { WebSessionStorage } from "../utils/web-session-storage";

describe("WebSessionStorage without a browser", () => {
  it("keeps everything in memory when window is unavailable", () => {
    const storage = new WebSessionStorage({ nitroAuthWebStorage: "local" });

    storage.saveScopes(["a"]);
    storage.saveRefreshToken("r1");
    storage.saveUser({ provider: "google", email: "a@b.c" });

    expect(storage.restore()).toEqual({
      scopes: ["a"],
      user: { provider: "google", email: "a@b.c" },
    });
    storage.clearSession();
    expect(storage.restore()).toEqual({});
    expect(storage.loadRefreshToken()).toBeUndefined();
  });
});

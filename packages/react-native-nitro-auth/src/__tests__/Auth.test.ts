import { NitroModules } from "react-native-nitro-modules";
import type { Auth } from "../Auth.nitro";

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => ({
      currentUser: undefined,
      login: jest.fn(),
      logout: jest.fn(),
    })),
  },
}));

describe("Auth Module", () => {
  let auth: Auth;

  beforeEach(() => {
    auth = NitroModules.createHybridObject<Auth>("Auth");
  });

  it("should have an undefined currentUser by default", () => {
    expect(auth.currentUser).toBeUndefined();
  });

  it("should call login with correct provider", async () => {
    await auth.login("google");
    expect(auth.login).toHaveBeenCalledWith("google");
  });

  it("should call logout", () => {
    auth.logout();
    expect(auth.logout).toHaveBeenCalled();
  });
});

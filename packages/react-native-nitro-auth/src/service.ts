import { NitroModules } from "react-native-nitro-modules";
import type { Auth } from "./Auth.nitro";
import { createAuthService } from "./create-auth-service";

let nitroAuth: Auth | undefined;

function getNitroAuth(): Auth {
  nitroAuth ??= NitroModules.createHybridObject<Auth>("Auth");
  return nitroAuth;
}

export const AuthService: Auth = createAuthService(getNitroAuth);

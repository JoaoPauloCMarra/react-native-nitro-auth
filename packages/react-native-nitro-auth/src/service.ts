import { NitroModules } from "react-native-nitro-modules";
import type { Auth } from "./Auth.nitro";
import { createAuthService } from "./create-auth-service";
import type { TypedAuth } from "./provider-options";

let nitroAuth: Auth | undefined;

function getNitroAuth(): Auth {
  nitroAuth ??= NitroModules.createHybridObject<Auth>("Auth");
  return nitroAuth;
}

function clearNitroAuth(auth: Auth): void {
  if (nitroAuth === auth) {
    nitroAuth = undefined;
  }
}

export const AuthService: TypedAuth = createAuthService(
  getNitroAuth,
  clearNitroAuth,
);

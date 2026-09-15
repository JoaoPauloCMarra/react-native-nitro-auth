import { NitroModules } from "react-native-nitro-modules";
import type { Auth } from "./Auth.nitro";
import { createAuthService } from "./create-auth-service";
import type { TypedAuth } from "./provider-options";

let nitroAuth: Auth | undefined;

function getNitroAuth(): Auth {
  if (nitroAuth) {
    return nitroAuth;
  }

  try {
    const auth = NitroModules.createHybridObject<Auth>("Auth");
    nitroAuth = auth;
    return auth;
  } catch (error) {
    throw Object.assign(new Error("Native Auth module is unavailable"), {
      code: "configuration_error" as const,
      underlyingMessage: error instanceof Error ? error.message : String(error),
    });
  }
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

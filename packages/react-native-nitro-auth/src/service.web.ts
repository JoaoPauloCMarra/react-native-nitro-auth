import { AuthModule } from "./Auth.web";
import { createAuthService } from "./create-auth-service";
import type { TypedAuth } from "./provider-options";

export const AuthService: TypedAuth = createAuthService(() => AuthModule);

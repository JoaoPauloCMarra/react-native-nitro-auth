import type { Auth } from "./Auth.nitro";
import { AuthModule } from "./Auth.web";
import { createAuthService } from "./create-auth-service";

export const AuthService: Auth = createAuthService(() => AuthModule);

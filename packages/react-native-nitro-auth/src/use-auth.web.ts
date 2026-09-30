import { createUseAuth } from "./create-use-auth";
import { AuthService } from "./service.web";

export type { UseAuthReturn } from "./create-use-auth";

export const useAuth = createUseAuth(AuthService);

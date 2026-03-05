import { NitroModules } from "react-native-nitro-modules";
import type {
  Auth,
  AuthProvider,
  AuthTokens,
  LoginOptions,
  AuthUser,
} from "./Auth.nitro";
import { AuthError } from "./utils/auth-error";

const nitroAuth = NitroModules.createHybridObject<Auth>("Auth");

export const AuthService: Auth = {
  get name() {
    return nitroAuth.name;
  },

  get currentUser() {
    return nitroAuth.currentUser;
  },

  get grantedScopes() {
    return nitroAuth.grantedScopes;
  },

  get hasPlayServices() {
    return nitroAuth.hasPlayServices;
  },

  async login(provider: AuthProvider, options?: LoginOptions) {
    try {
      await nitroAuth.login(provider, options);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async requestScopes(scopes: string[]) {
    try {
      await nitroAuth.requestScopes(scopes);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async revokeScopes(scopes: string[]) {
    try {
      await nitroAuth.revokeScopes(scopes);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async getAccessToken() {
    try {
      return await nitroAuth.getAccessToken();
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async refreshToken() {
    try {
      return await nitroAuth.refreshToken();
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  logout() {
    nitroAuth.logout();
  },

  async silentRestore() {
    try {
      await nitroAuth.silentRestore();
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
    return nitroAuth.onAuthStateChanged(callback);
  },

  onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
    return nitroAuth.onTokensRefreshed(callback);
  },

  setLoggingEnabled(enabled: boolean) {
    nitroAuth.setLoggingEnabled(enabled);
  },

  dispose() {
    nitroAuth.dispose();
  },

  equals(other: Parameters<Auth["equals"]>[0]): boolean {
    return nitroAuth.equals(other);
  },
};

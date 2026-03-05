import type {
  Auth,
  AuthProvider,
  AuthTokens,
  LoginOptions,
  AuthUser,
} from "./Auth.nitro";
import { AuthModule } from "./Auth.web";
import { AuthError } from "./utils/auth-error";

export const AuthService: Auth = {
  get name() {
    return AuthModule.name;
  },

  get currentUser() {
    return AuthModule.currentUser;
  },

  get grantedScopes() {
    return AuthModule.grantedScopes;
  },

  get hasPlayServices() {
    return AuthModule.hasPlayServices;
  },

  async login(provider: AuthProvider, options?: LoginOptions) {
    try {
      await AuthModule.login(provider, options);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async requestScopes(scopes: string[]) {
    try {
      await AuthModule.requestScopes(scopes);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async revokeScopes(scopes: string[]) {
    try {
      await AuthModule.revokeScopes(scopes);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async getAccessToken() {
    try {
      return await AuthModule.getAccessToken();
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async refreshToken() {
    try {
      return await AuthModule.refreshToken();
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  logout() {
    AuthModule.logout();
  },

  async silentRestore() {
    try {
      await AuthModule.silentRestore();
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
    return AuthModule.onAuthStateChanged(callback);
  },

  onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
    return AuthModule.onTokensRefreshed(callback);
  },

  setLoggingEnabled(enabled: boolean) {
    AuthModule.setLoggingEnabled(enabled);
  },

  dispose() {
    AuthModule.dispose();
  },

  equals(other: Parameters<Auth["equals"]>[0]): boolean {
    return AuthModule.equals(other);
  },
};

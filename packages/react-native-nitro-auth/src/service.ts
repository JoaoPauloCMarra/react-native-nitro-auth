import { NitroModules } from "react-native-nitro-modules";
import type {
  Auth,
  AuthProvider,
  AuthTokens,
  LoginOptions,
  AuthUser,
} from "./Auth.nitro";
import { AuthError } from "./utils/auth-error";

let nitroAuth: Auth | undefined;

function getNitroAuth(): Auth {
  nitroAuth ??= NitroModules.createHybridObject<Auth>("Auth");
  return nitroAuth;
}

export const AuthService: Auth = {
  get name() {
    return getNitroAuth().name;
  },

  get currentUser() {
    return getNitroAuth().currentUser;
  },

  get grantedScopes() {
    return getNitroAuth().grantedScopes;
  },

  get hasPlayServices() {
    return getNitroAuth().hasPlayServices;
  },

  async login(provider: AuthProvider, options?: LoginOptions) {
    try {
      await getNitroAuth().login(provider, options);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async requestScopes(scopes: string[]) {
    try {
      await getNitroAuth().requestScopes(scopes);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async revokeScopes(scopes: string[]) {
    try {
      await getNitroAuth().revokeScopes(scopes);
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async getAccessToken() {
    try {
      return await getNitroAuth().getAccessToken();
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  async refreshToken() {
    try {
      return await getNitroAuth().refreshToken();
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  logout() {
    getNitroAuth().logout();
  },

  async silentRestore() {
    try {
      await getNitroAuth().silentRestore();
      return;
    } catch (e) {
      throw AuthError.from(e);
    }
  },

  onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
    return getNitroAuth().onAuthStateChanged(callback);
  },

  onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
    return getNitroAuth().onTokensRefreshed(callback);
  },

  setLoggingEnabled(enabled: boolean) {
    getNitroAuth().setLoggingEnabled(enabled);
  },

  dispose() {
    getNitroAuth().dispose();
  },

  equals(other: Parameters<Auth["equals"]>[0]): boolean {
    return getNitroAuth().equals(other);
  },
};

import { NitroModules } from "react-native-nitro-modules";
import type {
  Auth,
  AuthProvider,
  AuthTokens,
  LoginOptions,
  AuthUser,
} from "./Auth.nitro";

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
    return nitroAuth.login(provider, options);
  },

  async requestScopes(scopes: string[]) {
    return nitroAuth.requestScopes(scopes);
  },

  async revokeScopes(scopes: string[]) {
    return nitroAuth.revokeScopes(scopes);
  },

  async getAccessToken() {
    return nitroAuth.getAccessToken();
  },

  async refreshToken() {
    return nitroAuth.refreshToken();
  },

  logout() {
    nitroAuth.logout();
  },

  async silentRestore() {
    return nitroAuth.silentRestore();
  },

  onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
    return nitroAuth.onAuthStateChanged(() => {
      callback(AuthService.currentUser);
    });
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

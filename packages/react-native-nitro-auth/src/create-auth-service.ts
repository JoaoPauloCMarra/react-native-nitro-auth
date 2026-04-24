import type {
  Auth,
  AuthProvider,
  AuthTokens,
  LoginOptions,
  AuthUser,
} from "./Auth.nitro";
import { AuthError } from "./utils/auth-error";

type AuthSource = () => Auth;
type AuthWithOptionalNativeMembers = Auth & {
  onAuthStateChanged?: (
    callback: (user: AuthUser | undefined) => void,
  ) => () => void;
  onTokensRefreshed?: (callback: (tokens: AuthTokens) => void) => () => void;
  setLoggingEnabled?: (enabled: boolean) => void;
};

async function wrapAuthOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    throw AuthError.from(e);
  }
}

export function createAuthService(getAuth: AuthSource): Auth {
  return {
    get name() {
      return getAuth().name;
    },

    get currentUser() {
      return getAuth().currentUser;
    },

    get grantedScopes() {
      const scopes = getAuth().grantedScopes;
      return Array.isArray(scopes) ? scopes : [];
    },

    get hasPlayServices() {
      return getAuth().hasPlayServices;
    },

    login(provider: AuthProvider, options?: LoginOptions) {
      return wrapAuthOperation(() => getAuth().login(provider, options));
    },

    requestScopes(scopes: string[]) {
      return wrapAuthOperation(() => getAuth().requestScopes(scopes));
    },

    revokeScopes(scopes: string[]) {
      return wrapAuthOperation(() => getAuth().revokeScopes(scopes));
    },

    getAccessToken() {
      return wrapAuthOperation(() => getAuth().getAccessToken());
    },

    refreshToken() {
      return wrapAuthOperation(() => getAuth().refreshToken());
    },

    logout() {
      getAuth().logout();
    },

    silentRestore() {
      return wrapAuthOperation(() => getAuth().silentRestore());
    },

    onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
      const auth = getAuth() as AuthWithOptionalNativeMembers;
      return auth.onAuthStateChanged?.(callback) ?? (() => {});
    },

    onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
      const auth = getAuth() as AuthWithOptionalNativeMembers;
      return auth.onTokensRefreshed?.(callback) ?? (() => {});
    },

    setLoggingEnabled(enabled: boolean) {
      const auth = getAuth() as AuthWithOptionalNativeMembers;
      auth.setLoggingEnabled?.(enabled);
    },

    dispose() {
      getAuth().dispose();
    },

    equals(other: Parameters<Auth["equals"]>[0]): boolean {
      return getAuth().equals(other);
    },
  };
}

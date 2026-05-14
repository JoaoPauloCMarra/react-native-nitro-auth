import type { Auth, AuthProvider, AuthTokens, AuthUser } from "./Auth.nitro";
import type { ProviderLoginOptions, TypedAuth } from "./provider-options";
import { AuthError } from "./utils/auth-error";

type AuthSource = () => Auth;
type AuthWithOptionalNativeMembers = Auth & {
  onAuthStateChanged?: (
    callback: (user: AuthUser | undefined) => void,
  ) => () => void;
  onTokensRefreshed?: (callback: (tokens: AuthTokens) => void) => () => void;
  revokeAccess?: () => Promise<void>;
  setLoggingEnabled?: (enabled: boolean) => void;
};

async function wrapAuthOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    throw AuthError.from(e);
  }
}

function wrapSyncAuthOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (e) {
    throw AuthError.from(e);
  }
}

export function createAuthService(getAuth: AuthSource): TypedAuth {
  return {
    get name() {
      return wrapSyncAuthOperation(() => getAuth().name);
    },

    get currentUser() {
      return wrapSyncAuthOperation(() => getAuth().currentUser);
    },

    get grantedScopes() {
      return wrapSyncAuthOperation(() => {
        const scopes = getAuth().grantedScopes;
        return Array.isArray(scopes) ? scopes : [];
      });
    },

    get hasPlayServices() {
      return wrapSyncAuthOperation(() => getAuth().hasPlayServices);
    },

    login<Provider extends AuthProvider>(
      provider: Provider,
      options?: ProviderLoginOptions<Provider>,
    ) {
      return wrapAuthOperation(() => getAuth().login(provider, options));
    },

    requestScopes(scopes: string[]) {
      return wrapAuthOperation(() => getAuth().requestScopes(scopes));
    },

    revokeScopes(scopes: string[]) {
      return wrapAuthOperation(() => getAuth().revokeScopes(scopes));
    },

    revokeAccess() {
      return wrapAuthOperation(async () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        if (auth.revokeAccess) {
          await auth.revokeAccess();
          return;
        }
        auth.logout();
      });
    },

    getAccessToken() {
      return wrapAuthOperation(() => getAuth().getAccessToken());
    },

    refreshToken() {
      return wrapAuthOperation(() => getAuth().refreshToken());
    },

    logout() {
      wrapSyncAuthOperation(() => {
        getAuth().logout();
      });
    },

    silentRestore() {
      return wrapAuthOperation(() => getAuth().silentRestore());
    },

    onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
      return wrapSyncAuthOperation(() => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return auth.onAuthStateChanged?.(callback) ?? (() => {});
      });
    },

    onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
      return wrapSyncAuthOperation(() => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return auth.onTokensRefreshed?.(callback) ?? (() => {});
      });
    },

    setLoggingEnabled(enabled: boolean) {
      wrapSyncAuthOperation(() => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        auth.setLoggingEnabled?.(enabled);
      });
    },

    dispose() {
      wrapSyncAuthOperation(() => {
        getAuth().dispose();
      });
    },

    equals(other: Parameters<Auth["equals"]>[0]): boolean {
      return wrapSyncAuthOperation(() => getAuth().equals(other));
    },
  };
}

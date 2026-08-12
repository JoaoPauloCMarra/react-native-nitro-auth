import type {
  Auth,
  AuthEvent,
  AuthProvider,
  AuthTokens,
  AuthUser,
  ScopeRevocationResult,
} from "./Auth.nitro";
import type { ProviderLoginOptions, TypedAuth } from "./provider-options";
import { AuthError, type AuthOperation } from "./utils/auth-error";

type AuthSource = () => Auth;
type AuthDisposeHandler = (auth: Auth) => void;
type AuthWithOptionalNativeMembers = Auth & {
  onAuthStateChanged?: (
    callback: (user: AuthUser | undefined) => void,
  ) => () => void;
  onTokensRefreshed?: (callback: (tokens: AuthTokens) => void) => () => void;
  onAuthEvent?: (callback: (event: AuthEvent) => void) => () => void;
  revokeAccess?: () => Promise<void>;
  setLoggingEnabled?: (enabled: boolean) => void;
};

async function wrapAuthOperation<T>(
  operation: AuthOperation,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw AuthError.from(e, operation);
  }
}

function wrapSyncAuthOperation<T>(
  operation: AuthOperation | undefined,
  run: () => T,
): T {
  try {
    return run();
  } catch (e) {
    throw AuthError.from(e, operation);
  }
}

export function createAuthService(
  getAuth: AuthSource,
  onDispose?: AuthDisposeHandler,
): TypedAuth {
  return {
    get name() {
      return wrapSyncAuthOperation(undefined, () => getAuth().name);
    },

    get currentUser() {
      return wrapSyncAuthOperation(undefined, () => getAuth().currentUser);
    },

    get grantedScopes() {
      return wrapSyncAuthOperation(undefined, () => {
        const scopes = getAuth().grantedScopes;
        return Array.isArray(scopes) ? scopes : [];
      });
    },

    get hasPlayServices() {
      return wrapSyncAuthOperation(undefined, () => getAuth().hasPlayServices);
    },

    login<Provider extends AuthProvider>(
      provider: Provider,
      options?: ProviderLoginOptions<Provider>,
    ) {
      return wrapAuthOperation("login", () =>
        getAuth().login(provider, options),
      );
    },

    requestScopes(scopes: string[]) {
      return wrapAuthOperation("requestScopes", () =>
        getAuth().requestScopes(scopes),
      );
    },

    revokeScopes(scopes: string[]): Promise<void> {
      return wrapAuthOperation("revokeScopes", () =>
        getAuth().revokeScopes(scopes),
      );
    },

    revokeScopesWithResult(scopes: string[]): Promise<ScopeRevocationResult> {
      return wrapAuthOperation("revokeScopes", async () => {
        const auth = getAuth();
        const scopesToRevoke = new Set(scopes);
        const revokedScopes = auth.grantedScopes.filter((scope) =>
          scopesToRevoke.has(scope),
        );
        await auth.revokeScopes(scopes);
        return { revokedAtProvider: false, revokedScopes };
      });
    },

    revokeAccess() {
      return wrapAuthOperation("revokeAccess", async () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        if (auth.revokeAccess) {
          await auth.revokeAccess();
          return;
        }
        throw new AuthError("configuration_error");
      });
    },

    getAccessToken() {
      return wrapAuthOperation("getAccessToken", () =>
        getAuth().getAccessToken(),
      );
    },

    refreshToken() {
      return wrapAuthOperation("refreshToken", () => getAuth().refreshToken());
    },

    logout() {
      wrapSyncAuthOperation("logout", () => {
        getAuth().logout();
      });
    },

    silentRestore() {
      return wrapAuthOperation("silentRestore", () =>
        getAuth().silentRestore(),
      );
    },

    onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return auth.onAuthStateChanged?.(callback) ?? (() => {});
      });
    },

    onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return auth.onTokensRefreshed?.(callback) ?? (() => {});
      });
    },

    onAuthEvent(callback: (event: AuthEvent) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return auth.onAuthEvent?.(callback) ?? (() => {});
      });
    },

    setLoggingEnabled(enabled: boolean) {
      wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        auth.setLoggingEnabled?.(enabled);
      });
    },

    dispose() {
      wrapSyncAuthOperation("dispose", () => {
        const auth = getAuth();
        auth.dispose();
        onDispose?.(auth);
      });
    },

    equals(other: Parameters<Auth["equals"]>[0]): boolean {
      return wrapSyncAuthOperation(undefined, () => getAuth().equals(other));
    },
  };
}

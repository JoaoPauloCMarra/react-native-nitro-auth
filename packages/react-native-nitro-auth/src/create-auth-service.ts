import type { AuthLifecycleEvent } from "./auth-events";
import type {
  Auth,
  AuthEvent,
  AuthProvider,
  AuthSessionSnapshot,
  AuthTokens,
  AuthUser,
  ScopeRevocationResult,
} from "./Auth.nitro";
import type {
  AuthCredential,
  CredentialOptions,
  CredentialProvider,
  ProviderLoginOptions,
  TypedAuth,
} from "./provider-options";
import { AuthError, type AuthOperation } from "./utils/auth-error";
import { logger } from "./utils/logger";

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
  resolveAuth: AuthSource,
  onDispose?: AuthDisposeHandler,
): TypedAuth {
  let snapshotSource: Auth | undefined;
  let sourceRevision = -1;
  let serviceRevision = 0;
  let snapshotCache: AuthSessionSnapshot | undefined;
  const normalizeSnapshot = (
    auth: Auth,
    snapshot: AuthSessionSnapshot,
  ): AuthSessionSnapshot => {
    if (
      snapshotSource !== auth ||
      snapshot.revision > sourceRevision ||
      !snapshotCache
    ) {
      snapshotSource = auth;
      sourceRevision = snapshot.revision;
      snapshotCache = { ...snapshot, revision: ++serviceRevision };
    }
    return snapshotCache;
  };
  const snapshotSubscribers = new Set<
    (snapshot: AuthSessionSnapshot) => void
  >();
  let snapshotBackend: Auth | undefined;
  let removeSnapshot: (() => void) | undefined;
  const publishSnapshot = (snapshot: AuthSessionSnapshot) => {
    for (const callback of [...snapshotSubscribers]) {
      if (!snapshotSubscribers.has(callback)) continue;
      try {
        callback(snapshot);
      } catch {
        logger.warn("Auth listener failed");
      }
    }
  };
  const getAuth = (): Auth => {
    const auth = resolveAuth();
    if (snapshotSubscribers.size > 0 && snapshotBackend !== auth) {
      removeSnapshot?.();
      removeSnapshot = undefined;
      snapshotBackend = auth;
      try {
        removeSnapshot = auth.onSessionChanged((snapshot) => {
          if (snapshotBackend === auth)
            publishSnapshot(normalizeSnapshot(auth, snapshot));
        });
        publishSnapshot(normalizeSnapshot(auth, auth.getSessionSnapshot()));
      } catch (error) {
        snapshotBackend = undefined;
        removeSnapshot?.();
        removeSnapshot = undefined;
        throw error;
      }
    }
    return auth;
  };
  const subscriptions = new Set<() => void>();
  const eventSubscribers = new Set<(event: AuthLifecycleEvent) => void>();
  let nextOperationId = 0;
  const pendingOperations = new Set<(error?: AuthError) => void>();
  const emitOperation = (event: AuthLifecycleEvent) => {
    for (const listener of [...eventSubscribers]) listener(event);
  };
  const wrapAuthOperation = async <T>(
    operation: AuthOperation,
    run: () => Promise<T>,
    provider?: AuthProvider,
  ): Promise<T> => {
    const context = {
      operation,
      operationId: ++nextOperationId,
      ...(provider ? { provider } : {}),
    };
    const started = performance.now();
    let settled = false;
    const finish = (error?: AuthError) => {
      if (settled) return;
      settled = true;
      pendingOperations.delete(finish);
      const terminal = {
        ...context,
        elapsedMilliseconds: Math.max(0, performance.now() - started),
      };
      emitOperation(
        error
          ? { ...terminal, type: "operation_failed", errorCode: error.code }
          : { ...terminal, type: "operation_succeeded" },
      );
    };
    pendingOperations.add(finish);
    emitOperation({ ...context, type: "operation_started" });
    try {
      const value = await run();
      finish();
      return value;
    } catch (failure) {
      const error = AuthError.from(failure, operation);
      finish(error);
      throw error;
    }
  };
  const subscribe = <T>(
    register: (listener: (value: T) => void) => () => void,
    callback: (value: T) => void,
  ): (() => void) => {
    let active = true;
    const listener = (value: T) => {
      if (!active) return;
      try {
        callback(value);
      } catch {
        logger.warn("Auth listener failed");
      }
    };
    const remove = register(listener);
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      subscriptions.delete(unsubscribe);
      remove();
    };
    subscriptions.add(unsubscribe);
    return unsubscribe;
  };
  let credentialAcquisitionInFlight = false;
  let sessionOperationsInFlight = 0;

  const runSessionOperation = async <T>(
    operation: AuthOperation,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (credentialAcquisitionInFlight) {
      throw new AuthError("operation_in_progress", operation);
    }
    sessionOperationsInFlight += 1;
    try {
      return await run();
    } finally {
      sessionOperationsInFlight -= 1;
    }
  };

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
      return wrapAuthOperation(
        "login",
        () =>
          runSessionOperation("login", () =>
            getAuth().login(provider, options),
          ),
        provider,
      );
    },

    loginAndGetUser<Provider extends AuthProvider>(
      provider: Provider,
      options?: ProviderLoginOptions<Provider>,
    ) {
      return wrapAuthOperation(
        "login",
        () =>
          runSessionOperation("login", () =>
            getAuth().loginAndGetUser(provider, options),
          ),
        provider,
      );
    },

    getCredential<Provider extends CredentialProvider>(
      provider: Provider,
      options?: CredentialOptions<Provider>,
    ): Promise<AuthCredential> {
      return wrapAuthOperation(
        "getCredential",
        async () => {
          if (provider !== "google" && provider !== "apple") {
            throw new AuthError("unsupported_provider", "getCredential");
          }
          if (credentialAcquisitionInFlight || sessionOperationsInFlight > 0) {
            throw new AuthError("operation_in_progress", "getCredential");
          }

          credentialAcquisitionInFlight = true;
          try {
            return await getAuth().getCredential(provider, options);
          } finally {
            credentialAcquisitionInFlight = false;
          }
        },
        provider,
      );
    },

    getSessionSnapshot() {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth();
        return normalizeSnapshot(auth, auth.getSessionSnapshot());
      });
    },

    onSessionChanged(callback: (snapshot: AuthSessionSnapshot) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        // Snapshot observers follow service recreation while mounted.
        const listener = (snapshot: AuthSessionSnapshot) => {
          callback(snapshot);
        };
        snapshotSubscribers.add(listener);
        try {
          getAuth();
        } catch (error) {
          snapshotSubscribers.delete(listener);
          throw error;
        }
        return () => {
          snapshotSubscribers.delete(listener);
          if (snapshotSubscribers.size === 0) {
            snapshotBackend = undefined;
            removeSnapshot?.();
            removeSnapshot = undefined;
          }
        };
      });
    },

    requestScopes(scopes: string[]) {
      return wrapAuthOperation("requestScopes", () =>
        runSessionOperation("requestScopes", () =>
          getAuth().requestScopes(scopes),
        ),
      );
    },

    revokeScopes(scopes: string[]): Promise<void> {
      return wrapAuthOperation("revokeScopes", () =>
        runSessionOperation("revokeScopes", () =>
          getAuth().revokeScopes(scopes),
        ),
      );
    },

    revokeScopesWithResult(scopes: string[]): Promise<ScopeRevocationResult> {
      return wrapAuthOperation("revokeScopes", () =>
        runSessionOperation("revokeScopes", () =>
          getAuth().revokeScopesWithResult(scopes),
        ),
      );
    },

    revokeAccess() {
      return wrapAuthOperation("revokeAccess", () =>
        runSessionOperation("revokeAccess", async () => {
          const auth = getAuth() as AuthWithOptionalNativeMembers;
          if (auth.revokeAccess) {
            await auth.revokeAccess();
            return;
          }
          throw new AuthError("configuration_error");
        }),
      );
    },

    getAccessToken() {
      return wrapAuthOperation("getAccessToken", () =>
        runSessionOperation("getAccessToken", () => getAuth().getAccessToken()),
      );
    },

    refreshToken() {
      return wrapAuthOperation("refreshToken", () =>
        runSessionOperation("refreshToken", () => getAuth().refreshToken()),
      );
    },

    logout() {
      wrapSyncAuthOperation("logout", () => {
        getAuth().logout();
      });
    },

    silentRestore() {
      return wrapAuthOperation("silentRestore", () =>
        runSessionOperation("silentRestore", () => getAuth().silentRestore()),
      );
    },

    onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return subscribe(
          (listener) => auth.onAuthStateChanged?.(listener) ?? (() => {}),
          callback,
        );
      });
    },

    onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return subscribe(
          (listener) => auth.onTokensRefreshed?.(listener) ?? (() => {}),
          callback,
        );
      });
    },

    onAuthEvent(callback: (event: AuthLifecycleEvent) => void) {
      return wrapSyncAuthOperation(undefined, () => {
        const auth = getAuth() as AuthWithOptionalNativeMembers;
        return subscribe((listener) => {
          eventSubscribers.add(listener);
          let remove: (() => void) | undefined;
          try {
            remove = auth.onAuthEvent?.((event) => {
              if (event.type !== "dispose") listener(event);
            });
          } catch (error) {
            eventSubscribers.delete(listener);
            throw error;
          }
          return () => {
            eventSubscribers.delete(listener);
            remove?.();
          };
        }, callback);
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
        try {
          auth.dispose();
          for (const finish of [...pendingOperations])
            finish(new AuthError("cancelled", "dispose"));
          for (const listener of [...eventSubscribers])
            listener({ type: "dispose" });
        } finally {
          for (const unsubscribe of [...subscriptions]) {
            try {
              unsubscribe();
            } catch {
              logger.warn("Auth listener cleanup failed");
            }
          }
          snapshotBackend = undefined;
          removeSnapshot?.();
          removeSnapshot = undefined;
          snapshotSource = undefined;
          sourceRevision = -1;
          snapshotCache = { revision: ++serviceRevision, scopes: [] };
          onDispose?.(auth);
          publishSnapshot(snapshotCache);
        }
      });
    },

    equals(other: Parameters<Auth["equals"]>[0]): boolean {
      return wrapSyncAuthOperation(undefined, () => getAuth().equals(other));
    },
  };
}

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  AuthUser,
  AuthProvider,
  AuthTokens,
  ScopeRevocationResult,
} from "./Auth.nitro";
import type {
  AuthLogin,
  ProviderLoginOptions,
  TypedAuth,
} from "./provider-options";
import { createSessionStore } from "./session-store";
import { AuthError } from "./utils/auth-error";

const EMPTY_SCOPES: string[] = [];

function normalizeScopes(scopes: string[] | undefined): string[] {
  return Array.isArray(scopes) ? scopes : EMPTY_SCOPES;
}

type AuthState = {
  user: AuthUser | undefined;
  scopes: string[];
  loading: boolean;
  error: AuthError | undefined;
};

const areScopesEqual = (left: string[], right: string[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  let matchesInOrder = true;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      matchesInOrder = false;
      break;
    }
  }
  if (matchesInOrder) return true;

  const remaining = new Set(left);
  for (const scope of right) {
    if (!remaining.delete(scope)) {
      return false;
    }
  }
  return remaining.size === 0;
};

export type UseAuthReturn = AuthState & {
  hasPlayServices: boolean;
  login: AuthLogin;
  logout: () => void;
  requestScopes: (scopes: string[]) => Promise<void>;
  revokeScopes: (scopes: string[]) => Promise<void>;
  revokeScopesWithResult: (scopes: string[]) => Promise<ScopeRevocationResult>;
  revokeAccess: () => Promise<void>;
  getAccessToken: () => Promise<string | undefined>;
  refreshToken: () => Promise<AuthTokens>;
  silentRestore: () => Promise<void>;
};

export function createUseAuth(AuthService: TypedAuth): () => UseAuthReturn {
  const sessionStore = createSessionStore(AuthService);

  return function useAuth(): UseAuthReturn {
    const [state, setState] = useState<AuthState>(() => {
      const snapshot = sessionStore.getSnapshot();
      return {
        user: snapshot.user,
        scopes: snapshot.scopes,
        loading: false,
        error: undefined,
      };
    });

    const syncStateFromService = useCallback(
      (nextLoading: boolean, nextError: AuthError | undefined) => {
        sessionStore.refresh();
        const snapshot = sessionStore.getSnapshot();
        const nextUser = snapshot.user;
        const nextScopes = normalizeScopes(snapshot.scopes);
        setState((prev) => {
          if (
            prev.loading === nextLoading &&
            prev.error === nextError &&
            prev.user === nextUser &&
            areScopesEqual(prev.scopes, nextScopes)
          ) {
            return prev;
          }
          return {
            user: nextUser,
            scopes: nextScopes,
            loading: nextLoading,
            error: nextError,
          };
        });
      },
      [],
    );

    const inFlight = useRef(0);

    const runOperation = useCallback(
      async <T>(operation: () => Promise<T>): Promise<T> => {
        inFlight.current += 1;
        setState((prev) => ({ ...prev, loading: true, error: undefined }));
        try {
          const value = await operation();
          inFlight.current -= 1;
          syncStateFromService(inFlight.current > 0, undefined);
          return value;
        } catch (e) {
          inFlight.current -= 1;
          const error = AuthError.from(e);
          const loading = inFlight.current > 0;
          setState((prev) => ({ ...prev, loading, error }));
          throw error;
        }
      },
      [syncStateFromService],
    );

    const login = useCallback(
      <Provider extends AuthProvider>(
        provider: Provider,
        options?: ProviderLoginOptions<Provider>,
      ) => {
        return runOperation(() => AuthService.login(provider, options));
      },
      [runOperation],
    );

    const logout = useCallback(() => {
      AuthService.logout();
      setState((prev) => {
        if (
          prev.user === undefined &&
          prev.scopes.length === 0 &&
          prev.loading === false &&
          prev.error === undefined
        ) {
          return prev;
        }
        return {
          user: undefined,
          scopes: EMPTY_SCOPES,
          loading: false,
          error: undefined,
        };
      });
    }, []);

    const requestScopes = useCallback(
      async (newScopes: string[]) => {
        return runOperation(() => AuthService.requestScopes(newScopes));
      },
      [runOperation],
    );

    const revokeScopes = useCallback(
      async (scopesToRevoke: string[]): Promise<void> => {
        return runOperation(() => AuthService.revokeScopes(scopesToRevoke));
      },
      [runOperation],
    );

    const revokeScopesWithResult = useCallback(
      async (scopesToRevoke: string[]): Promise<ScopeRevocationResult> => {
        return runOperation(() =>
          AuthService.revokeScopesWithResult(scopesToRevoke),
        );
      },
      [runOperation],
    );

    const revokeAccess = useCallback(async () => {
      return runOperation(() => AuthService.revokeAccess());
    }, [runOperation]);

    const getAccessToken = useCallback(() => AuthService.getAccessToken(), []);

    const refreshToken = useCallback(async () => {
      return runOperation(() => AuthService.refreshToken());
    }, [runOperation]);

    const silentRestore = useCallback(async () => {
      return runOperation(() => AuthService.silentRestore());
    }, [runOperation]);

    useEffect(() => {
      const syncSnapshot = () => {
        const snapshot = sessionStore.getSnapshot();
        setState((prev) => {
          if (
            prev.user === snapshot.user &&
            areScopesEqual(prev.scopes, snapshot.scopes)
          )
            return prev;
          return { ...prev, user: snapshot.user, scopes: snapshot.scopes };
        });
      };
      const unsubscribe = sessionStore.subscribe(syncSnapshot);
      syncSnapshot();
      return unsubscribe;
    }, []);

    return useMemo(
      () => ({
        ...state,
        hasPlayServices: AuthService.hasPlayServices,
        login,
        logout,
        requestScopes,
        revokeScopes,
        revokeScopesWithResult,
        revokeAccess,
        getAccessToken,
        refreshToken,
        silentRestore,
      }),
      [
        state,
        login,
        logout,
        requestScopes,
        revokeScopes,
        revokeScopesWithResult,
        revokeAccess,
        getAccessToken,
        refreshToken,
        silentRestore,
      ],
    );
  };
}

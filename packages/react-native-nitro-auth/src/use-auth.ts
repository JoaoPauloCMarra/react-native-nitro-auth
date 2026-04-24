import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  AuthUser,
  AuthProvider,
  LoginOptions,
  AuthTokens,
} from "./Auth.nitro";
import { AuthService } from "./service";
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
  login: (provider: AuthProvider, options?: LoginOptions) => Promise<void>;
  logout: () => void;
  requestScopes: (scopes: string[]) => Promise<void>;
  revokeScopes: (scopes: string[]) => Promise<void>;
  getAccessToken: () => Promise<string | undefined>;
  refreshToken: () => Promise<AuthTokens>;
  silentRestore: () => Promise<void>;
};

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    user: AuthService.currentUser,
    scopes: normalizeScopes(AuthService.grantedScopes),
    loading: false,
    error: undefined,
  });

  const syncStateFromService = useCallback(
    (nextLoading: boolean, nextError: AuthError | undefined) => {
      const nextUser = AuthService.currentUser;
      const nextScopes = normalizeScopes(AuthService.grantedScopes);
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

  const login = useCallback(
    async (provider: AuthProvider, options?: LoginOptions) => {
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        await AuthService.login(provider, options);
        syncStateFromService(false, undefined);
      } catch (e) {
        const error = AuthError.from(e);
        setState((prev) => ({ ...prev, loading: false, error }));
        throw error;
      }
    },
    [syncStateFromService],
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
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        await AuthService.requestScopes(newScopes);
        syncStateFromService(false, undefined);
      } catch (e) {
        const error = AuthError.from(e);
        setState((prev) => ({ ...prev, loading: false, error }));
        throw error;
      }
    },
    [syncStateFromService],
  );

  const revokeScopes = useCallback(
    async (scopesToRevoke: string[]) => {
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        await AuthService.revokeScopes(scopesToRevoke);
        syncStateFromService(false, undefined);
      } catch (e) {
        const error = AuthError.from(e);
        setState((prev) => ({ ...prev, loading: false, error }));
        throw error;
      }
    },
    [syncStateFromService],
  );

  const getAccessToken = useCallback(() => AuthService.getAccessToken(), []);

  const refreshToken = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const tokens = await AuthService.refreshToken();
      syncStateFromService(false, undefined);
      return tokens;
    } catch (e) {
      const error = AuthError.from(e);
      setState((prev) => ({ ...prev, loading: false, error }));
      throw error;
    }
  }, [syncStateFromService]);

  const silentRestore = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      await AuthService.silentRestore();
      syncStateFromService(false, undefined);
    } catch (e) {
      const error = AuthError.from(e);
      setState((prev) => ({ ...prev, loading: false, error }));
      throw error;
    }
  }, [syncStateFromService]);

  useEffect(() => {
    const unsubscribeAuth = AuthService.onAuthStateChanged((currentUser) => {
      const nextScopes = normalizeScopes(AuthService.grantedScopes);
      setState((prev) => {
        if (
          prev.user === currentUser &&
          areScopesEqual(prev.scopes, nextScopes) &&
          prev.loading === false
        ) {
          return prev;
        }
        return {
          ...prev,
          user: currentUser,
          scopes: nextScopes,
          loading: false,
        };
      });
    });
    const unsubscribeTokens = AuthService.onTokensRefreshed?.(() => {
      syncStateFromService(false, undefined);
    });
    return () => {
      unsubscribeAuth();
      unsubscribeTokens?.();
    };
  }, [syncStateFromService]);

  return useMemo(
    () => ({
      ...state,
      hasPlayServices: AuthService.hasPlayServices,
      login,
      logout,
      requestScopes,
      revokeScopes,
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
      getAccessToken,
      refreshToken,
      silentRestore,
    ],
  );
}

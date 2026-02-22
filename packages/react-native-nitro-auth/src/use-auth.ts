import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  AuthUser,
  AuthProvider,
  LoginOptions,
  AuthTokens,
} from "./Auth.nitro";
import { AuthService } from "./service";

type AuthState = {
  user: AuthUser | undefined;
  scopes: string[];
  loading: boolean;
  error: Error | undefined;
};

const areScopesEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

class AuthHookError extends Error {
  public readonly underlyingError?: string;

  constructor(message: string, underlyingError?: string) {
    super(message);
    this.name = "AuthHookError";
    this.underlyingError = underlyingError;
  }
}

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
    scopes: AuthService.grantedScopes,
    loading: false,
    error: undefined,
  });

  const syncStateFromService = useCallback(
    (nextLoading: boolean, nextError: Error | undefined) => {
      const nextUser = AuthService.currentUser;
      const nextScopes = AuthService.grantedScopes;
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
        const error = e instanceof Error ? e : new Error(String(e));
        setState((prev) => ({
          ...prev,
          loading: false,
          error,
        }));
        throw error;
      }
    },
    [syncStateFromService],
  );

  const logout = useCallback(() => {
    AuthService.logout();
    setState({
      user: undefined,
      scopes: [],
      loading: false,
      error: undefined,
    });
  }, []);

  const requestScopes = useCallback(
    async (newScopes: string[]) => {
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        await AuthService.requestScopes(newScopes);
        syncStateFromService(false, undefined);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        setState((prev) => ({
          ...prev,
          loading: false,
          error,
        }));
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
        const error = e instanceof Error ? e : new Error(String(e));
        setState((prev) => ({
          ...prev,
          loading: false,
          error,
        }));
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
      const msg = e instanceof Error ? e.message : String(e);
      const authError = new AuthHookError(
        msg,
        AuthService.currentUser?.underlyingError,
      );
      setState((prev) => ({
        ...prev,
        loading: false,
        error: authError,
      }));
      throw authError;
    }
  }, [syncStateFromService]);

  const silentRestore = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      await AuthService.silentRestore();
      syncStateFromService(false, undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      setState((prev) => ({
        ...prev,
        loading: false,
        error,
      }));
      throw error;
    }
  }, [syncStateFromService]);

  useEffect(() => {
    const unsubscribe = AuthService.onAuthStateChanged((currentUser) => {
      const nextScopes = AuthService.grantedScopes;
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

import { useState, useEffect, useCallback, useMemo } from "react";
import { AuthService } from "./service";
import type {
  AuthUser,
  AuthProvider,
  LoginOptions,
  AuthTokens,
} from "./Auth.nitro";

interface AuthState {
  user: AuthUser | undefined;
  scopes: string[];
  loading: boolean;
  error: Error | undefined;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: AuthService.currentUser,
    scopes: AuthService.grantedScopes,
    loading: false,
    error: undefined,
  });

  const login = useCallback(
    async (provider: AuthProvider, options?: LoginOptions) => {
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        await AuthService.login(provider, options);
        setState({
          user: AuthService.currentUser,
          scopes: AuthService.grantedScopes,
          loading: false,
          error: undefined,
        });
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
    []
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

  const requestScopes = useCallback(async (newScopes: string[]) => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      await AuthService.requestScopes(newScopes);
      setState({
        user: AuthService.currentUser,
        scopes: AuthService.grantedScopes,
        loading: false,
        error: undefined,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      setState((prev) => ({
        ...prev,
        loading: false,
        error,
      }));
      throw error;
    }
  }, []);

  const revokeScopes = useCallback(async (scopesToRevoke: string[]) => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      await AuthService.revokeScopes(scopesToRevoke);
      setState({
        user: AuthService.currentUser,
        scopes: AuthService.grantedScopes,
        loading: false,
        error: undefined,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      setState((prev) => ({
        ...prev,
        loading: false,
        error,
      }));
      throw error;
    }
  }, []);

  const getAccessToken = useCallback(() => AuthService.getAccessToken(), []);

  const refreshToken = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const tokens = await AuthService.refreshToken();
      setState({
        user: AuthService.currentUser,
        scopes: AuthService.grantedScopes,
        loading: false,
        error: undefined,
      });
      return tokens;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      setState((prev) => ({
        ...prev,
        loading: false,
        error,
      }));
      throw error;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = AuthService.onAuthStateChanged((currentUser) => {
      setState((prev) => ({
        ...prev,
        user: currentUser,
        scopes: AuthService.grantedScopes,
      }));
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
    }),
    [
      state,
      login,
      logout,
      requestScopes,
      revokeScopes,
      getAccessToken,
      refreshToken,
    ]
  );
}

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
    [],
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
  }, []);

  const silentRestore = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      await AuthService.silentRestore();
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

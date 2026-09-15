import type {
  Auth,
  AuthEvent,
  AuthProvider,
  AuthNonce,
  AuthTokens,
  AuthUser,
  LoginOptions,
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

type AuthSource = () => Auth;
type AuthDisposeHandler = (auth: Auth) => void;
type AuthWithOptionalNativeMembers = Auth & {
  loginForCredential?: (
    provider: AuthProvider,
    options?: LoginOptions,
  ) => Promise<void>;
  onAuthStateChanged?: (
    callback: (user: AuthUser | undefined) => void,
  ) => () => void;
  onTokensRefreshed?: (callback: (tokens: AuthTokens) => void) => () => void;
  onAuthEvent?: (callback: (event: AuthEvent) => void) => () => void;
  revokeAccess?: () => Promise<void>;
  setLoggingEnabled?: (enabled: boolean) => void;
};

function hasCurrentUser(auth: Auth): boolean {
  return auth.currentUser !== undefined;
}

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
  let credentialAcquisitionInFlight = false;
  let sessionOperationsInFlight = 0;
  let authOperationGeneration = 0;

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
      return wrapAuthOperation("login", () =>
        runSessionOperation("login", () => getAuth().login(provider, options)),
      );
    },

    loginAndGetUser<Provider extends AuthProvider>(
      provider: Provider,
      options?: ProviderLoginOptions<Provider>,
    ) {
      return wrapAuthOperation("login", () =>
        runSessionOperation("login", async () => {
          await getAuth().login(provider, options);
          const user = getAuth().currentUser;
          if (!user) {
            throw new AuthError("not_signed_in", "login");
          }
          return user;
        }),
      );
    },

    getCredential<Provider extends CredentialProvider>(
      provider: Provider,
      options?: CredentialOptions<Provider>,
    ): Promise<AuthCredential> {
      return wrapAuthOperation("getCredential", async () => {
        if (provider !== "google" && provider !== "apple") {
          throw new AuthError("unsupported_provider", "getCredential");
        }
        if (credentialAcquisitionInFlight || sessionOperationsInFlight > 0) {
          throw new AuthError("operation_in_progress", "getCredential");
        }

        const auth = getAuth();
        if (hasCurrentUser(auth)) {
          throw new AuthError("invalid_state", "getCredential");
        }

        credentialAcquisitionInFlight = true;
        try {
          const operationGeneration = authOperationGeneration;
          let nativeLoginStarted = false;
          let hasPrimaryError = false;
          let primaryError: unknown;
          let credential: AuthCredential | undefined;

          try {
            const nonce: AuthNonce = await auth.createNonce();
            if (operationGeneration !== authOperationGeneration) {
              throw new AuthError("cancelled", "getCredential");
            }
            if (
              typeof nonce?.raw !== "string" ||
              nonce.raw.length === 0 ||
              typeof nonce.hashed !== "string" ||
              !/^[a-f0-9]{64}$/.test(nonce.hashed)
            ) {
              throw new AuthError("invalid_nonce", "getCredential");
            }

            const loginOptions: LoginOptions = {
              ...options,
              scopes:
                options?.scopes ??
                (provider === "google"
                  ? ["openid", "email", "profile"]
                  : ["email", "fullName"]),
              nonce: nonce.hashed,
            };
            delete loginOptions.useLegacyGoogleSignIn;

            nativeLoginStarted = true;
            const loginForCredential = (auth as AuthWithOptionalNativeMembers)
              .loginForCredential;
            if (loginForCredential) {
              await loginForCredential.call(auth, provider, loginOptions);
            } else {
              await auth.login(provider, loginOptions);
            }
            if (operationGeneration !== authOperationGeneration) {
              throw new AuthError("cancelled", "getCredential");
            }

            const user = auth.currentUser;
            if (user?.provider !== provider) {
              throw new AuthError("invalid_state", "getCredential");
            }
            if (typeof user.idToken !== "string" || user.idToken.length === 0) {
              throw new AuthError("no_id_token", "getCredential");
            }

            const copiedUser: AuthUser = { ...user };
            if (user.scopes) {
              copiedUser.scopes = [...user.scopes];
            }
            credential = {
              provider,
              idToken: user.idToken,
              nonce: nonce.raw,
              user: copiedUser,
            };
          } catch (error: unknown) {
            hasPrimaryError = true;
            primaryError = error;
          }

          if (nativeLoginStarted) {
            try {
              auth.logout();
            } catch (cleanupError: unknown) {
              if (!hasPrimaryError) {
                hasPrimaryError = true;
                primaryError = cleanupError;
              }
            }
          }

          if (hasPrimaryError) {
            throw primaryError;
          }
          if (!credential) {
            throw new AuthError("unknown", "getCredential");
          }
          return credential;
        } finally {
          credentialAcquisitionInFlight = false;
        }
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
        runSessionOperation("revokeScopes", async () => {
          const auth = getAuth();
          const scopesToRevoke = new Set(scopes);
          const revokedScopes = auth.grantedScopes.filter((scope) =>
            scopesToRevoke.has(scope),
          );
          await auth.revokeScopes(scopes);
          return { revokedAtProvider: false, revokedScopes };
        }),
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
        authOperationGeneration += 1;
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
        authOperationGeneration += 1;
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

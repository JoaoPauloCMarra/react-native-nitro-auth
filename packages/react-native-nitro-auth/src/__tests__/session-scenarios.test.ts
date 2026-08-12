/**
 * Shared session-lifecycle scenario suite (U3 / item 10).
 *
 * Every scenario runs against both backends:
 * - the real web `AuthModule` (jsdom), and
 * - a controllable model of the native C++ coordinator wrapped by the
 *   service boundary (`createAuthService`).
 *
 * The native model mirrors `cpp/HybridAuth.cpp` semantics: generation-based
 * cancellation, tracked session promises, in-flight refresh dedupe, and
 * logout/dispose settling pending work. The same scenario IDs run in
 * `cpp/__tests__/HybridAuthTests.cpp`.
 *
 * Documented platform divergence (SC-09): starting a second login while one
 * is pending cancels the first on native (generation advance) while web
 * rejects the second with `operation_in_progress` (a second popup cannot be
 * coordinated). Both backends settle every promise with a typed result.
 */

import { TextDecoder, TextEncoder } from "util";
import { createAuthService } from "../create-auth-service";
import type { AuthTokens, AuthUser } from "../Auth.nitro";

type SessionFacade = {
  login(provider: "google" | "microsoft"): Promise<void>;
  logout(): void;
  refreshToken(): Promise<AuthTokens>;
  silentRestore(): Promise<void>;
  dispose(): void;
  onAuthStateChanged(
    callback: (user: AuthUser | undefined) => void,
  ): () => void;
  get currentUser(): AuthUser | undefined;
  get grantedScopes(): string[];
};

type SessionControls = {
  loginWillHang(provider: "google" | "microsoft"): void;
  loginWillSucceed(user: AuthUser, provider: "google" | "microsoft"): void;
  loginWillFail(error: unknown, provider: "google" | "microsoft"): void;
  /** The first login settles as cancelled, per backend mechanism. */
  loginWillBeCancelled(provider: "google" | "microsoft"): void;
  refreshWillHang(): void;
  refreshWillSucceed(tokens: AuthTokens): void;
  refreshWillFail(error: unknown): void;
};

const base64UrlEncode = (value: Record<string, unknown>) => {
  const base64 = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const createJwt = (payload: Record<string, unknown>) => {
  const header = base64UrlEncode({ alg: "none", typ: "JWT" });
  return `${header}.${base64UrlEncode(payload)}.sig`;
};

/* ------------------------------------------------------------------ */
/* Web backend                                                         */
/* ------------------------------------------------------------------ */

type PopupMock = {
  closed: boolean;
  close: jest.Mock;
  location: { href: string };
};

function installPopupMock(onRedirect: (state?: string) => string): PopupMock {
  const popup: PopupMock = {
    closed: false,
    close: jest.fn(),
    location: { href: "" },
  };
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: jest.fn((url: string) => {
      const state = new URL(url).searchParams.get("state") ?? undefined;
      popup.location.href = onRedirect(state);
      return popup;
    }),
  });
  return popup;
}

function installFetchMock(response: Partial<Response>): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: jest.fn(async () => response as Response),
  });
}

async function createWebFacade(): Promise<{
  facade: SessionFacade;
  controls: SessionControls;
}> {
  jest.resetModules();
  jest.doMock(
    "expo-constants",
    () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra: {
            microsoftClientId: "test-client-id",
            googleWebClientId: "test-client-id.apps.googleusercontent.com",
          },
        },
      },
    }),
    { virtual: true },
  );
  const module = await import("../Auth.web");
  const auth = module.AuthModule;
  const { resetAuthModule } = module;
  // The public boundary is the service wrapper: it attaches the typed
  // `operation` phase to every failure envelope.
  // Static import used to keep the suite self-contained for both backends.
  const service = createAuthService(() => auth, resetAuthModule);

  const facade: SessionFacade = {
    login: (provider) => service.login(provider),
    logout: () => {
      service.logout();
    },
    refreshToken: () => {
      return service.refreshToken();
    },
    silentRestore: () => {
      return service.silentRestore();
    },
    dispose: () => {
      service.dispose();
    },
    onAuthStateChanged: (callback) => service.onAuthStateChanged(callback),
    get currentUser() {
      return service.currentUser;
    },
    get grantedScopes() {
      return service.grantedScopes;
    },
  };

  const googleSuccessRedirect = (user: AuthUser) => {
    const idToken = createJwt({
      nonce: "test-random-uuid",
      email: user.email ?? "scenario@example.com",
    });
    return (state?: string) => {
      if (!state) {
        throw new Error("Expected state parameter in Google auth URL");
      }
      return `${window.location.origin}#id_token=${idToken}&state=${state}&expires_in=3600`;
    };
  };

  const microsoftSuccessFlow = (user: AuthUser) => {
    const idToken = createJwt({
      nonce: "test-random-uuid",
      email: user.email ?? "scenario@example.com",
    });
    installPopupMock((state) => {
      if (!state) {
        throw new Error("Expected state parameter in Microsoft auth URL");
      }
      return `${window.location.origin}?code=auth-code&state=${state}`;
    });
    installFetchMock({
      ok: true,
      json: async () => ({
        id_token: idToken,
        access_token: "fresh-access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      }),
    });
  };

  const controls: SessionControls = {
    loginWillHang: (provider) => {
      if (provider === "google") {
        installPopupMock(() => "https://accounts.google.com/signin");
      } else {
        installPopupMock(() => "https://login.microsoftonline.com/signin");
      }
    },
    loginWillSucceed: (user, provider) => {
      if (provider === "google") {
        installPopupMock(googleSuccessRedirect(user));
      } else {
        microsoftSuccessFlow(user);
      }
    },
    loginWillFail: (error, provider) => {
      const message = error instanceof Error ? error.message : "cancelled";
      if (message === "cancelled") {
        // Web cancellation surfaces through the popup being closed by the
        // user, not through an OAuth error parameter.
        const popup = installPopupMock(() => "");
        popup.closed = true;
        return;
      }
      installPopupMock((state) => {
        if (!state) {
          throw new Error("Expected state parameter in auth URL");
        }
        return `${window.location.origin}#error=${encodeURIComponent(message)}&state=${state}`;
      });
      void provider;
    },
    loginWillBeCancelled: (provider) => {
      if (provider === "google") {
        installPopupMock((state) => {
          if (!state) {
            throw new Error("Expected state parameter in Google auth URL");
          }
          return `${window.location.origin}#error=access_denied&state=${state}`;
        });
      } else {
        installPopupMock(() => "https://login.microsoftonline.com/signin");
      }
    },
    refreshWillHang: () => {
      installFetchMock({
        ok: true,
        json: () => new Promise<never>(() => {}),
      });
    },
    refreshWillSucceed: (tokens) => {
      installFetchMock({
        ok: true,
        json: async () => ({
          id_token: createJwt({ nonce: "test-random-uuid" }),
          access_token: tokens.accessToken ?? "fresh",
          refresh_token: tokens.refreshToken ?? "refresh-token",
          expires_in: 3600,
        }),
      });
    },
    refreshWillFail: (error) => {
      void error;
      installFetchMock({
        ok: false,
        json: async () => ({
          error: "invalid_grant",
          error_description: "The grant is expired",
        }),
      });
    },
  };

  return { facade, controls };
}

/* ------------------------------------------------------------------ */
/* Native backend (C++ coordinator model + service boundary)          */
/* ------------------------------------------------------------------ */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createNativeFacade(): {
  facade: SessionFacade;
  controls: SessionControls;
} {
  const state = {
    currentUser: undefined as AuthUser | undefined,
    grantedScopes: [] as string[],
    generation: 0,
    listeners: [] as ((user: AuthUser | undefined) => void)[],
    inFlightRefresh: undefined as
      | { promise: Promise<AuthTokens>; reject: (e: unknown) => void }
      | undefined,
    pendingSessionPromises: [] as {
      promise: Promise<unknown>;
      reject: (e: unknown) => void;
    }[],
    loginInFlight: false,
    disposed: false,
  };

  const notify = () => {
    for (const listener of [...state.listeners]) {
      listener(state.currentUser);
    }
  };

  const rejectPendingSessions = (message: string) => {
    for (const entry of state.pendingSessionPromises) {
      entry.reject(new Error(message));
    }
    state.pendingSessionPromises = [];
  };

  const advanceGeneration = () => {
    state.generation++;
    const refresh = state.inFlightRefresh;
    state.inFlightRefresh = undefined;
    rejectPendingSessions("cancelled");
    return refresh;
  };

  let nextLoginOutcome:
    | undefined
    | ((entry: {
        resolve: (user: AuthUser) => void;
        reject: (e: unknown) => void;
      }) => void);
  let nextRefreshOutcome:
    | undefined
    | ((entry: {
        resolve: (tokens: AuthTokens) => void;
        reject: (e: unknown) => void;
      }) => void);
  let nextRestoreOutcome:
    | undefined
    | ((entry: {
        resolve: (user: AuthUser | undefined) => void;
        reject: (e: unknown) => void;
      }) => void);

  const login = (provider: "google" | "microsoft"): Promise<void> => {
    if (state.disposed) {
      return Promise.reject(new Error("cancelled"));
    }
    if (state.loginInFlight) {
      // Mirrors HybridAuth + platform behavior: the new login advances the
      // session generation (cancelling prior session work), then the platform
      // rejects the duplicate with operation_in_progress.
      const refresh = advanceGeneration();
      if (refresh) {
        refresh.reject(new Error("cancelled"));
      }
      return Promise.reject(new Error("operation_in_progress"));
    }
    state.loginInFlight = true;
    const refresh = advanceGeneration();
    if (refresh) {
      refresh.reject(new Error("cancelled"));
    }
    const generation = state.generation;
    const entry = deferred<AuthUser>();
    const applyOutcome = nextLoginOutcome;
    nextLoginOutcome = undefined;
    let rejectSession!: (error: unknown) => void;
    const sessionPromise = new Promise<void>((resolve, reject) => {
      rejectSession = reject;
      void entry.promise.then(
        (user) => {
          if (state.generation !== generation) {
            reject(new Error("cancelled"));
            return;
          }
          state.currentUser = user;
          state.grantedScopes = user.scopes ?? [];
          notify();
          resolve();
        },
        (error) => {
          reject(error);
        },
      );
    });
    state.pendingSessionPromises.push({
      promise: sessionPromise,
      reject: rejectSession,
    });
    // The coordinator may reject this promise before the caller attaches a
    // handler (e.g. a new login cancelling a pending one); keep the model
    // free of unhandled-rejection noise.
    void sessionPromise
      .catch(() => {})
      .finally(() => {
        state.loginInFlight = false;
      })
      .catch(() => {});
    applyOutcome?.(entry);
    void provider;
    return sessionPromise;
  };

  const refreshToken = (): Promise<AuthTokens> => {
    if (state.inFlightRefresh) {
      return state.inFlightRefresh.promise;
    }
    const generation = state.generation;
    const entry = deferred<AuthTokens>();
    const applyOutcome = nextRefreshOutcome;
    nextRefreshOutcome = undefined;
    const guarded = new Promise<AuthTokens>((resolve, reject) => {
      void entry.promise.then(
        (tokens) => {
          if (state.generation !== generation) {
            reject(new Error("cancelled"));
            return;
          }
          resolve(tokens);
        },
        (error) => {
          reject(error);
        },
      );
    });
    state.inFlightRefresh = {
      promise: guarded,
      reject: (error) => {
        entry.reject(error);
      },
    };
    applyOutcome?.(entry);
    return guarded;
  };

  const silentRestore = (): Promise<void> => {
    if (state.disposed) {
      return Promise.reject(new Error("cancelled"));
    }
    const entry = deferred<AuthUser | undefined>();
    const applyOutcome = nextRestoreOutcome;
    nextRestoreOutcome = undefined;
    let rejectSession!: (error: unknown) => void;
    const sessionPromise = new Promise<void>((resolve, reject) => {
      rejectSession = reject;
      void entry.promise.then(
        (user) => {
          state.currentUser = user;
          state.grantedScopes = user?.scopes ?? [];
          notify();
          resolve();
        },
        (error) => {
          reject(error);
        },
      );
    });
    state.pendingSessionPromises.push({
      promise: sessionPromise,
      reject: rejectSession,
    });
    void sessionPromise.catch(() => {});
    // With no registered outcome, the platform reports "no session".
    if (applyOutcome) {
      applyOutcome(entry);
    } else {
      entry.resolve(undefined);
    }
    return sessionPromise;
  };

  const logout = () => {
    const refresh = advanceGeneration();
    if (refresh) {
      refresh.reject(new Error("not_signed_in"));
    }
    state.currentUser = undefined;
    state.grantedScopes = [];
    notify();
  };

  const dispose = () => {
    state.disposed = true;
    const refresh = advanceGeneration();
    if (refresh) {
      refresh.reject(new Error("cancelled"));
    }
    state.currentUser = undefined;
    state.grantedScopes = [];
    state.listeners = [];
  };

  const auth = {
    get name() {
      return "Auth";
    },
    get currentUser() {
      return state.currentUser;
    },
    get grantedScopes() {
      return state.grantedScopes;
    },
    get hasPlayServices() {
      return true;
    },
    login,
    requestScopes: () => Promise.resolve(),
    revokeScopes: () => Promise.resolve(),
    revokeAccess: () => Promise.resolve(),
    getAccessToken: () => Promise.resolve(undefined),
    refreshToken,
    logout,
    silentRestore,
    onAuthStateChanged: (callback: (user: AuthUser | undefined) => void) => {
      state.listeners.push(callback);
      return () => {
        state.listeners = state.listeners.filter((l) => l !== callback);
      };
    },
    onTokensRefreshed: () => () => undefined,
    onAuthEvent: () => () => undefined,
    setLoggingEnabled: () => {},
    dispose,
    equals: (other: unknown) => other === auth,
  };

  // Static import used to keep the suite self-contained for both backends.
  const service = createAuthService(() => auth);

  const facade: SessionFacade = {
    login: (provider) => service.login(provider),
    logout: () => {
      service.logout();
    },
    refreshToken: () => {
      return service.refreshToken();
    },
    silentRestore: () => {
      return service.silentRestore();
    },
    dispose: () => {
      service.dispose();
    },
    onAuthStateChanged: (callback) => service.onAuthStateChanged(callback),
    get currentUser() {
      return service.currentUser;
    },
    get grantedScopes() {
      return service.grantedScopes;
    },
  };

  const controls: SessionControls = {
    loginWillHang: () => {
      nextLoginOutcome = undefined;
    },
    loginWillSucceed: (user) => {
      nextLoginOutcome = (entry) => {
        entry.resolve(user);
      };
    },
    loginWillFail: (error) => {
      nextLoginOutcome = (entry) => {
        entry.reject(error);
      };
    },
    loginWillBeCancelled: () => {
      nextLoginOutcome = undefined;
    },
    refreshWillHang: () => {
      nextRefreshOutcome = undefined;
    },
    refreshWillSucceed: (tokens) => {
      nextRefreshOutcome = (entry) => {
        entry.resolve(tokens);
      };
    },
    refreshWillFail: (error) => {
      nextRefreshOutcome = (entry) => {
        entry.reject(error);
      };
    },
  };

  return { facade, controls };
}

/* ------------------------------------------------------------------ */
/* Shared scenarios                                                    */
/* ------------------------------------------------------------------ */

type BackendFactory = () => Promise<{
  facade: SessionFacade;
  controls: SessionControls;
}>;

const runScenarios = (backendName: string, create: BackendFactory) => {
  describe(`${backendName} backend`, () => {
    let backend: Awaited<ReturnType<BackendFactory>>;

    beforeEach(async () => {
      backend = await create();
    });

    it("SC-01 login success exposes the user and notifies listeners", async () => {
      const seen: (AuthUser | undefined)[] = [];
      backend.facade.onAuthStateChanged((user) => {
        seen.push(user);
      });

      const user: AuthUser = {
        provider: "google",
        email: "scenario@example.com",
        scopes: ["email"],
      };
      backend.controls.loginWillSucceed(user, "google");
      await backend.facade.login("google");

      expect(backend.facade.currentUser?.email).toBe("scenario@example.com");
      expect(backend.facade.grantedScopes).toEqual(
        expect.arrayContaining(["email"]),
      );
      expect(seen).toContainEqual(
        expect.objectContaining({
          provider: "google",
          email: "scenario@example.com",
        }),
      );
    });

    it("SC-02 login failure leaves no user", async () => {
      backend.controls.loginWillFail(new Error("cancelled"), "google");
      await expect(backend.facade.login("google")).rejects.toMatchObject({
        code: "cancelled",
      });

      expect(backend.facade.currentUser).toBeUndefined();
      expect(backend.facade.grantedScopes).toEqual([]);
    });

    it("SC-03 logout cancels an in-flight refresh and settles it", async () => {
      const user: AuthUser = { provider: "microsoft", email: "a@example.com" };
      backend.controls.loginWillSucceed(user, "microsoft");
      await backend.facade.login("microsoft");

      backend.controls.refreshWillHang();
      const refreshPromise = backend.facade.refreshToken();
      backend.facade.logout();

      await expect(refreshPromise).rejects.toMatchObject({
        code: "not_signed_in",
      });
      expect(backend.facade.currentUser).toBeUndefined();
    });

    it("SC-04 logout clears user and scopes and notifies listeners", async () => {
      const user: AuthUser = { provider: "google", scopes: ["email"] };
      backend.controls.loginWillSucceed(user, "google");
      await backend.facade.login("google");

      const seen: (AuthUser | undefined)[] = [];
      backend.facade.onAuthStateChanged((next) => {
        seen.push(next);
      });
      backend.facade.logout();

      expect(backend.facade.currentUser).toBeUndefined();
      expect(backend.facade.grantedScopes).toEqual([]);
      expect(seen).toContain(undefined);
    });

    it("SC-05 dispose rejects a pending login with a typed code", async () => {
      backend.controls.loginWillHang("google");
      const loginPromise = backend.facade.login("google");
      backend.facade.dispose();

      await expect(loginPromise).rejects.toMatchObject({ code: "cancelled" });
    });

    it("SC-06 concurrent refresh calls share one in-flight operation", async () => {
      const user: AuthUser = { provider: "microsoft" };
      backend.controls.loginWillSucceed(user, "microsoft");
      await backend.facade.login("microsoft");

      const tokens: AuthTokens = { accessToken: "fresh" };
      backend.controls.refreshWillSucceed(tokens);
      const first = backend.facade.refreshToken();
      const second = backend.facade.refreshToken();

      await expect(first).resolves.toEqual(
        expect.objectContaining({ accessToken: "fresh" }),
      );
      await expect(second).resolves.toEqual(
        expect.objectContaining({ accessToken: "fresh" }),
      );
    });

    it("SC-07 silent restore without a session resolves without a user", async () => {
      await expect(backend.facade.silentRestore()).resolves.toBeUndefined();
      expect(backend.facade.currentUser).toBeUndefined();
    });

    it("SC-08 refresh failure settles with a typed code", async () => {
      const user: AuthUser = { provider: "microsoft" };
      backend.controls.loginWillSucceed(user, "microsoft");
      await backend.facade.login("microsoft");

      backend.controls.refreshWillFail(
        new Error("refresh_failed: invalid_grant"),
      );
      const refreshPromise = backend.facade.refreshToken();

      await expect(refreshPromise).rejects.toMatchObject({
        code: "refresh_failed",
        operation: "refreshToken",
      });
    });

    it("SC-09 concurrent login settles every promise with a typed result", async () => {
      backend.controls.loginWillBeCancelled("google");
      const first = backend.facade.login("google");
      const second = backend.facade.login("google");

      const outcomeOf = async (promise: Promise<void>) => {
        try {
          await promise;
          return "resolved";
        } catch (error) {
          return error instanceof Error && "code" in error
            ? String((error as { code: string }).code)
            : "rejected";
        }
      };

      // Both promises must settle. Native cancels the first login (generation
      // advance) and rejects the second with operation_in_progress; web keeps
      // the first popup alive (browser-owned, cannot be closed cross-origin)
      // and rejects the second with operation_in_progress. See
      // docs/error-contract.md SC-09 divergence note.
      const outcomes = await Promise.all([outcomeOf(first), outcomeOf(second)]);
      expect(outcomes.sort()).toEqual(
        ["cancelled", "operation_in_progress"].sort(),
      );
    });
  });
};

describe("Session lifecycle scenarios", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.clearAllMocks();
    jest.useRealTimers();
    if (typeof globalThis.crypto.randomUUID !== "function") {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        writable: true,
        value: () => "test-random-uuid",
      });
    }
    if (typeof globalThis.TextEncoder !== "function") {
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: TextEncoder,
      });
    }
    if (typeof globalThis.TextDecoder !== "function") {
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: TextDecoder,
      });
    }
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: {
        digest: jest.fn<
          Promise<ArrayBuffer>,
          [AlgorithmIdentifier, BufferSource]
        >(async () => new ArrayBuffer(32)),
      },
    });
  });

  afterEach(() => {
    jest.resetModules();
  });

  runScenarios("web", () => createWebFacade());
  runScenarios("native", () => Promise.resolve(createNativeFacade()));
});

import { NitroModules } from "react-native-nitro-modules";
import type {
  Auth,
  AuthProvider,
  AuthTokens,
  AuthUser,
  LoginOptions,
} from "./Auth.nitro";
import type { AuthStorageAdapter } from "./AuthStorage.nitro";

const STORAGE_KEY = "nitro_auth_user";
const SCOPES_KEY = "nitro_auth_scopes";

export interface JSStorageAdapter {
  save(key: string, value: string): void | Promise<void>;
  load(key: string): string | undefined | Promise<string | undefined>;
  remove(key: string): void | Promise<void>;
}

const nitroAuth = NitroModules.createHybridObject<Auth>("Auth");

let jsStorageAdapter: JSStorageAdapter | undefined;
let cachedUser: AuthUser | undefined;
let cachedScopes: string[] = [];

async function loadFromJSStorage() {
  if (!jsStorageAdapter) return;
  const json = await jsStorageAdapter.load(STORAGE_KEY);
  if (json) {
    try {
      cachedUser = JSON.parse(json);
    } catch {}
  }
  const scopesJson = await jsStorageAdapter.load(SCOPES_KEY);
  if (scopesJson) {
    try {
      cachedScopes = JSON.parse(scopesJson);
    } catch {}
  }
}

async function saveToJSStorage(user: AuthUser | undefined) {
  if (!jsStorageAdapter) return;
  if (user) {
    await jsStorageAdapter.save(STORAGE_KEY, JSON.stringify(user));
    await jsStorageAdapter.save(SCOPES_KEY, JSON.stringify(cachedScopes));
  } else {
    await jsStorageAdapter.remove(STORAGE_KEY);
    await jsStorageAdapter.remove(SCOPES_KEY);
  }
}

export const AuthService: Auth & {
  setJSStorageAdapter(adapter: JSStorageAdapter | undefined): void;
} = {
  get name() {
    return nitroAuth.name;
  },

  get currentUser() {
    return jsStorageAdapter ? cachedUser : nitroAuth.currentUser;
  },

  get grantedScopes() {
    return jsStorageAdapter ? cachedScopes : nitroAuth.grantedScopes;
  },

  get hasPlayServices() {
    return nitroAuth.hasPlayServices;
  },

  async login(provider: AuthProvider, options?: LoginOptions) {
    await nitroAuth.login(provider, options);
    if (jsStorageAdapter) {
      cachedUser = nitroAuth.currentUser;
      cachedScopes = options?.scopes ?? nitroAuth.grantedScopes;
      if (cachedUser) cachedUser.scopes = cachedScopes;
      await saveToJSStorage(cachedUser);
    }
  },

  async requestScopes(scopes: string[]) {
    await nitroAuth.requestScopes(scopes);
    if (jsStorageAdapter) {
      cachedUser = nitroAuth.currentUser;
      for (const s of scopes) {
        if (!cachedScopes.includes(s)) cachedScopes.push(s);
      }
      if (cachedUser) cachedUser.scopes = cachedScopes;
      await saveToJSStorage(cachedUser);
    }
  },

  async revokeScopes(scopes: string[]) {
    await nitroAuth.revokeScopes(scopes);
    if (jsStorageAdapter) {
      cachedScopes = cachedScopes.filter((s) => !scopes.includes(s));
      if (cachedUser) cachedUser.scopes = cachedScopes;
      await saveToJSStorage(cachedUser);
    }
  },

  async getAccessToken() {
    return nitroAuth.getAccessToken();
  },

  async refreshToken() {
    const tokens = await nitroAuth.refreshToken();
    if (jsStorageAdapter && cachedUser) {
      cachedUser.accessToken = tokens.accessToken;
      cachedUser.idToken = tokens.idToken;
      await saveToJSStorage(cachedUser);
    }
    return tokens;
  },

  logout() {
    nitroAuth.logout();
    if (jsStorageAdapter) {
      cachedUser = undefined;
      cachedScopes = [];
      saveToJSStorage(undefined);
    }
  },

  async silentRestore() {
    await nitroAuth.silentRestore();
    if (jsStorageAdapter) {
      cachedUser = nitroAuth.currentUser;
      cachedScopes = nitroAuth.grantedScopes;
      await saveToJSStorage(cachedUser);
    }
  },

  onAuthStateChanged(callback: (user: AuthUser | undefined) => void) {
    return nitroAuth.onAuthStateChanged(() => {
      callback(AuthService.currentUser);
    });
  },

  onTokensRefreshed(callback: (tokens: AuthTokens) => void) {
    return nitroAuth.onTokensRefreshed(callback);
  },

  setLoggingEnabled(enabled: boolean) {
    nitroAuth.setLoggingEnabled(enabled);
  },

  setStorageAdapter(adapter: AuthStorageAdapter | undefined): void {
    nitroAuth.setStorageAdapter(adapter);
  },

  async setJSStorageAdapter(adapter: JSStorageAdapter | undefined) {
    jsStorageAdapter = adapter;
    if (adapter) {
      await loadFromJSStorage();
    } else {
      cachedUser = undefined;
      cachedScopes = [];
    }
  },

  dispose() {
    nitroAuth.dispose();
  },

  equals(other: unknown): boolean {
    return (nitroAuth as { equals(o: unknown): boolean }).equals(other);
  },
};

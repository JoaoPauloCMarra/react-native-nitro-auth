import { AuthModule } from "./Auth.web";
import type { JSStorageAdapter } from "./service";

/**
 * Web AuthService with JSStorageAdapter support.
 * On web, setStorageAdapter already accepts plain JS objects,
 * so setJSStorageAdapter is just an alias.
 */
export const AuthService = {
  ...AuthModule,

  get name() {
    return AuthModule.name;
  },

  get currentUser() {
    return AuthModule.currentUser;
  },

  get grantedScopes() {
    return AuthModule.grantedScopes;
  },

  get hasPlayServices() {
    return AuthModule.hasPlayServices;
  },

  login: AuthModule.login.bind(AuthModule),
  logout: AuthModule.logout.bind(AuthModule),
  requestScopes: AuthModule.requestScopes.bind(AuthModule),
  revokeScopes: AuthModule.revokeScopes.bind(AuthModule),
  getAccessToken: AuthModule.getAccessToken.bind(AuthModule),
  refreshToken: AuthModule.refreshToken.bind(AuthModule),
  silentRestore: AuthModule.silentRestore.bind(AuthModule),
  onAuthStateChanged: AuthModule.onAuthStateChanged.bind(AuthModule),
  onTokensRefreshed: AuthModule.onTokensRefreshed.bind(AuthModule),
  setLoggingEnabled: AuthModule.setLoggingEnabled.bind(AuthModule),
  setStorageAdapter: AuthModule.setStorageAdapter.bind(AuthModule),
  dispose: AuthModule.dispose.bind(AuthModule),
  equals: AuthModule.equals.bind(AuthModule),

  // JS storage adapter - on web this is the same as setStorageAdapter
  // since web already accepts plain JS objects
  setJSStorageAdapter(adapter: JSStorageAdapter | undefined) {
    // Web implementation directly accepts JS objects as storage adapters
    AuthModule.setStorageAdapter(
      adapter as Parameters<typeof AuthModule.setStorageAdapter>[0],
    );
  },
};

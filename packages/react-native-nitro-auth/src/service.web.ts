import { AuthModule } from "./Auth.web";

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
  dispose: AuthModule.dispose.bind(AuthModule),
  equals: AuthModule.equals.bind(AuthModule),
};

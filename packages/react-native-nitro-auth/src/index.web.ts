export * from "./Auth.nitro";
export type {
  GoogleIOSLoginOptions,
  GoogleAndroidLoginOptions,
  GoogleWebLoginOptions,
  GoogleLoginOptions,
  AppleIOSLoginOptions,
  AppleAndroidScope,
  AppleAndroidLoginOptions,
  AppleWebLoginOptions,
  AppleLoginOptions,
  MicrosoftLoginOptions,
  LoginOptionsByProvider,
  ProviderLoginOptions,
  CredentialOptions,
  AuthLogin,
  AuthLoginAndGetUser,
  AuthGetCredential,
  TypedAuth,
} from "./provider-options";
export type { AuthLifecycleEvent, AuthOperationEvent } from "./auth-events";
export * from "./capabilities";
export * from "./ui/social-button.web";
export { useAuth, type UseAuthReturn } from "./use-auth";
export { AuthService } from "./service.web";
export {
  AuthError,
  isAuthErrorCode,
  toAuthErrorCode,
  type AuthErrorDetails,
  type AuthOperation,
} from "./utils/auth-error";

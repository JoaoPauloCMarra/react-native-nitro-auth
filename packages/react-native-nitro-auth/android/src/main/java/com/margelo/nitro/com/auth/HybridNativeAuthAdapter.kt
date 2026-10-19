package com.margelo.nitro.com.auth

import com.auth.AuthAdapter
import com.auth.LoginRequest
import com.auth.Origin
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.Locale

/** Typed provider boundary. ProviderRequestRegistry rejects callbacks from cancelled operations. */
class HybridNativeAuthAdapter : HybridNativeAuthAdapterSpec() {
    private fun context() = checkNotNull(NitroModules.applicationContext) {
        "Auth requires an initialized React Native context"
    }.also { AuthAdapter.initialize(it) }

    override fun createNonce(): AuthNonce = AuthAdapter.createNonce()

    override fun login(provider: AuthProvider, options: LoginOptions?) = userRequest(Origin.LOGIN) { id ->
        AuthAdapter.loginSync(context(), LoginRequest(
            provider = provider,
            scopes = options?.scopes,
            loginHint = options?.loginHint,
            nonce = options?.nonce,
            useOneTap = options?.useOneTap ?: false,
            forceAccountPicker = options?.forceAccountPicker ?: false,
            useLegacyGoogleSignIn = options?.useLegacyGoogleSignIn ?: false,
            filterByAuthorizedAccounts = options?.filterByAuthorizedAccounts ?: false,
            forceCodeForRefreshToken = options?.forceCodeForRefreshToken ?: false,
            requestVerifiedPhoneNumber = options?.requestVerifiedPhoneNumber ?: false,
            tenant = options?.tenant,
            prompt = options?.prompt?.name?.lowercase(Locale.ROOT),
            hostedDomain = options?.hostedDomain,
        ), id)
    }
    override fun requestScopes(scopes: Array<String>) = userRequest(Origin.SCOPES) {
        AuthAdapter.requestScopesSync(context(), scopes, it)
    }
    override fun silentRestore() = userRequest(Origin.SILENT) { AuthAdapter.restoreSession(context(), it) }
    override fun refreshToken(): Promise<ProviderTokenResult> {
        val promise = Promise<ProviderTokenResult>()
        val id = ProviderRequestRegistry.registerTokens { promise.resolve(it) }
        try { AuthAdapter.refreshTokenSync(context(), id) }
        catch (_: Exception) { ProviderRequestRegistry.refreshError(AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
        return promise
    }
    override fun revokeAccess(provider: AuthProvider): Promise<ProviderVoidResult> {
        val promise = Promise<ProviderVoidResult>()
        val id = ProviderRequestRegistry.registerRevocation { promise.resolve(it) }
        try { AuthAdapter.revokeAccessSync(context(), provider, id) }
        catch (_: Exception) { ProviderRequestRegistry.revokeResult(AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
        return promise
    }
    override fun hasPlayServices() = AuthAdapter.hasPlayServices(context())
    override fun invalidatePendingOperations() { AuthAdapter.cancelPendingOperations() }
    override fun cancel() {
        AuthAdapter.cancelPendingOperations()
        ProviderRequestRegistry.cancelAll()
    }
    override fun logout() {
        cancel()
        AuthAdapter.logoutSync(context())
    }

    private fun userRequest(origin: Origin, start: (Long) -> Unit): Promise<ProviderUserResult> {
        val promise = Promise<ProviderUserResult>()
        val id = ProviderRequestRegistry.registerUser(origin) { promise.resolve(it) }
        try { start(id) }
        catch (_: Exception) { ProviderRequestRegistry.loginError(origin, AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
        return promise
    }
}

package com.margelo.nitro.com.auth

import com.auth.AuthAdapter
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.Locale

/** Typed provider boundary. ProviderRequestRegistry rejects callbacks from cancelled operations. */
class HybridNativeAuthAdapter : HybridNativeAuthAdapterSpec() {
    private fun context() = checkNotNull(NitroModules.applicationContext) {
        "Auth requires an initialized React Native context"
    }.also { AuthAdapter.initialize(it) }

    override fun createNonce(): AuthNonce {
        val nonce = AuthAdapter.createNonce()
        return AuthNonce(nonce[0], nonce[1])
    }

    override fun login(provider: AuthProvider, options: LoginOptions?) = userRequest("login") { id ->
        AuthAdapter.loginSync(context(), provider.name.lowercase(Locale.ROOT), options?.scopes,
            options?.loginHint, options?.nonce, options?.useOneTap ?: false,
            options?.forceAccountPicker ?: false, options?.useLegacyGoogleSignIn ?: false,
            options?.filterByAuthorizedAccounts ?: false, options?.forceCodeForRefreshToken ?: false,
            options?.requestVerifiedPhoneNumber ?: false, options?.tenant,
            options?.prompt?.name?.lowercase(Locale.ROOT), options?.hostedDomain, options?.openIDRealm, id)
    }
    override fun requestScopes(scopes: Array<String>) = userRequest("scopes") {
        AuthAdapter.requestScopesSync(context(), scopes, it)
    }
    override fun silentRestore() = userRequest("silent") { AuthAdapter.restoreSession(context(), it) }
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
        try { AuthAdapter.revokeAccessSync(context(), provider.name.lowercase(Locale.ROOT), id) }
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

    private fun userRequest(origin: String, start: (Long) -> Unit): Promise<ProviderUserResult> {
        val promise = Promise<ProviderUserResult>()
        val id = ProviderRequestRegistry.registerUser(origin) { promise.resolve(it) }
        try { start(id) }
        catch (_: Exception) { ProviderRequestRegistry.loginError(origin, AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
        return promise
    }
}

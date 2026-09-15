package com.margelo.nitro.com.auth

import com.auth.AuthAdapter
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.Locale

/** Typed provider boundary. The registry rejects callbacks from cancelled operations. */
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
        val id = synchronized(lock) { (++sequence).also { tokens[it] = promise } }
        try { AuthAdapter.refreshTokenSync(context(), id) }
        catch (_: Exception) { refreshError(AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
        return promise
    }
    override fun revokeAccess(provider: AuthProvider): Promise<ProviderVoidResult> {
        val promise = Promise<ProviderVoidResult>()
        val id = synchronized(lock) { (++sequence).also { revocations[it] = promise } }
        try { AuthAdapter.revokeAccessSync(context(), provider.name.lowercase(Locale.ROOT), id) }
        catch (_: Exception) { revokeResult(AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
        return promise
    }
    override fun hasPlayServices() = AuthAdapter.hasPlayServices(context())
    override fun invalidatePendingOperations() { AuthAdapter.cancelPendingOperations() }
    override fun cancel() {
        AuthAdapter.cancelPendingOperations()
        cancelAll()
    }
    override fun logout() {
        cancel()
        AuthAdapter.logoutSync(context())
    }

    companion object {
        private val lock = Any()
        private var sequence = 0L
        private data class UserRequest(val origin: String, val promise: Promise<ProviderUserResult>)
        private val users = mutableMapOf<Long, UserRequest>()
        private val tokens = mutableMapOf<Long, Promise<ProviderTokenResult>>()
        private val revocations = mutableMapOf<Long, Promise<ProviderVoidResult>>()
        private fun failure(code: Int, detail: String?) = ProviderFailure(
            AuthErrorCode.entries.firstOrNull { it.value == code } ?: AuthErrorCode.UNKNOWN, detail)
        private fun takeUser(origin: String, id: Long): Promise<ProviderUserResult>? = synchronized(lock) {
            if (users[id]?.origin == origin) users.remove(id)?.promise else null
        }
        private fun userRequest(origin: String, start: (Long) -> Unit): Promise<ProviderUserResult> {
            val promise = Promise<ProviderUserResult>()
            val id = synchronized(lock) { (++sequence).also { users[it] = UserRequest(origin, promise) } }
            try { start(id) }
            catch (_: Exception) { loginError(origin, AuthErrorCode.CONFIGURATION_ERROR.value, null, id) }
            return promise
        }
        fun loginSuccess(origin: String, provider: String, email: String?, name: String?,
            firstName: String?, lastName: String?, photo: String?, idToken: String?, accessToken: String?,
            serverAuthCode: String?, userId: String?, phoneNumber: String?, hostedDomain: String?,
            scopes: Array<String>?, expirationTime: Long?, generation: Long): Boolean {
            val promise = takeUser(origin, generation) ?: return false
            val typedProvider = AuthProvider.entries.firstOrNull { it.name.lowercase(Locale.ROOT) == provider }
            val result = if (typedProvider == null || (expirationTime != null && expirationTime < 0)) {
                ProviderUserResult(null, failure(AuthErrorCode.PARSE_ERROR.value, null))
            } else ProviderUserResult(AuthUser(typedProvider, email, name, firstName, lastName, photo,
                idToken, accessToken, null, serverAuthCode,
                if (typedProvider == AuthProvider.APPLE) serverAuthCode else null,
                userId, phoneNumber, hostedDomain, scopes, expirationTime?.toDouble(), null), null)
            promise.resolve(result)
            return result.failure == null
        }
        fun loginError(origin: String, code: Int, detail: String?, generation: Long): Boolean {
            val promise = takeUser(origin, generation) ?: return false
            promise.resolve(ProviderUserResult(null, failure(code, detail)))
            return true
        }
        fun refreshSuccess(idToken: String?, accessToken: String?, expirationTime: Long?, generation: Long): Boolean {
            val promise = synchronized(lock) { tokens.remove(generation) } ?: return false
            promise.resolve(ProviderTokenResult(AuthTokens(accessToken, idToken, null, expirationTime?.toDouble()), null))
            return true
        }
        fun refreshError(code: Int, detail: String?, generation: Long): Boolean {
            val promise = synchronized(lock) { tokens.remove(generation) } ?: return false
            promise.resolve(ProviderTokenResult(null, failure(code, detail)))
            return true
        }
        fun revokeResult(code: Int?, detail: String?, generation: Long): Boolean {
            val promise = synchronized(lock) { revocations.remove(generation) } ?: return false
            promise.resolve(ProviderVoidResult(code?.let { failure(it, detail) }))
            return true
        }
        fun cancelAll() {
            val pending = synchronized(lock) {
                Triple(users.values.toList(), tokens.values.toList(), revocations.values.toList()).also {
                    users.clear(); tokens.clear(); revocations.clear()
                }
            }
            val cancelled = failure(AuthErrorCode.CANCELLED.value, null)
            pending.first.forEach { it.promise.resolve(ProviderUserResult(null, cancelled)) }
            pending.second.forEach { it.resolve(ProviderTokenResult(null, cancelled)) }
            pending.third.forEach { it.resolve(ProviderVoidResult(cancelled)) }
        }
    }
}

package com.margelo.nitro.com.auth

import java.util.Locale

internal object ProviderRequestRegistry {
    private val lock = Any()
    private var sequence = 0L
    private data class UserRequest(val origin: String, val resolve: (ProviderUserResult) -> Unit)
    private val users = mutableMapOf<Long, UserRequest>()
    private val tokens = mutableMapOf<Long, (ProviderTokenResult) -> Unit>()
    private val revocations = mutableMapOf<Long, (ProviderVoidResult) -> Unit>()

    fun registerUser(origin: String, resolve: (ProviderUserResult) -> Unit): Long =
        synchronized(lock) { (++sequence).also { users[it] = UserRequest(origin, resolve) } }

    fun registerTokens(resolve: (ProviderTokenResult) -> Unit): Long =
        synchronized(lock) { (++sequence).also { tokens[it] = resolve } }

    fun registerRevocation(resolve: (ProviderVoidResult) -> Unit): Long =
        synchronized(lock) { (++sequence).also { revocations[it] = resolve } }

    private fun failure(code: Int, detail: String?) = ProviderFailure(
        AuthErrorCode.entries.firstOrNull { it.value == code } ?: AuthErrorCode.UNKNOWN, detail)

    private fun takeUser(origin: String, id: Long): ((ProviderUserResult) -> Unit)? = synchronized(lock) {
        if (users[id]?.origin == origin) users.remove(id)?.resolve else null
    }

    fun loginSuccess(origin: String, provider: String, email: String?, name: String?,
        firstName: String?, lastName: String?, photo: String?, idToken: String?, accessToken: String?,
        serverAuthCode: String?, userId: String?, phoneNumber: String?, hostedDomain: String?,
        scopes: Array<String>?, expirationTime: Long?, generation: Long): Boolean {
        val resolve = takeUser(origin, generation) ?: return false
        val typedProvider = AuthProvider.entries.firstOrNull { it.name.lowercase(Locale.ROOT) == provider }
        val result = if (typedProvider == null || (expirationTime != null && expirationTime < 0)) {
            ProviderUserResult(null, failure(AuthErrorCode.PARSE_ERROR.value, null))
        } else ProviderUserResult(AuthUser(typedProvider, email, name, firstName, lastName, photo,
            idToken, accessToken, null, serverAuthCode,
            if (typedProvider == AuthProvider.APPLE) serverAuthCode else null,
            userId, phoneNumber, hostedDomain, scopes, expirationTime?.toDouble(), null), null)
        resolve(result)
        return result.failure == null
    }

    fun loginError(origin: String, code: Int, detail: String?, generation: Long): Boolean {
        val resolve = takeUser(origin, generation) ?: return false
        resolve(ProviderUserResult(null, failure(code, detail)))
        return true
    }

    fun refreshSuccess(idToken: String?, accessToken: String?, expirationTime: Long?, generation: Long): Boolean {
        val resolve = synchronized(lock) { tokens.remove(generation) } ?: return false
        resolve(ProviderTokenResult(AuthTokens(accessToken, idToken, null, expirationTime?.toDouble()), null))
        return true
    }

    fun refreshError(code: Int, detail: String?, generation: Long): Boolean {
        val resolve = synchronized(lock) { tokens.remove(generation) } ?: return false
        resolve(ProviderTokenResult(null, failure(code, detail)))
        return true
    }

    fun revokeResult(code: Int?, detail: String?, generation: Long): Boolean {
        val resolve = synchronized(lock) { revocations.remove(generation) } ?: return false
        resolve(ProviderVoidResult(code?.let { failure(it, detail) }))
        return true
    }

    fun cancelAll() {
        val pending = synchronized(lock) {
            Triple(users.values.toList(), tokens.values.toList(), revocations.values.toList()).also {
                users.clear(); tokens.clear(); revocations.clear()
            }
        }
        val cancelled = failure(AuthErrorCode.CANCELLED.value, null)
        pending.first.forEach { it.resolve(ProviderUserResult(null, cancelled)) }
        pending.second.forEach { it(ProviderTokenResult(null, cancelled)) }
        pending.third.forEach { it(ProviderVoidResult(cancelled)) }
    }
}

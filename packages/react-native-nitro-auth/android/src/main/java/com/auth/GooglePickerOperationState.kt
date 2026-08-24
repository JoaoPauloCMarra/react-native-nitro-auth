package com.auth

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred

internal data class GooglePickerOperation(
    val identity: Any,
    val origin: String,
    val generation: Long,
    val stateEpoch: Long,
    val launchClaimed: Boolean = false,
)

internal enum class GooglePickerSignOutDecision {
    START,
    WAIT,
    READY,
    REJECT,
}

internal data class GooglePickerSignOutResult(
    val activeIdentity: Any?,
    val retryAtMillis: Long? = null,
)

internal class GooglePickerOperationState(
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
) {
    private data class SignOutCleanup(
        var owner: Any,
        var targetAccountId: String?,
        var attempt: Int,
        var retryAtMillis: Long,
        var inFlight: Boolean,
        val completion: CompletableDeferred<Unit>,
    )

    private companion object {
        const val MAX_BACKOFF_MILLIS = 4_000L
    }

    private var activeOperation: GooglePickerOperation? = null
    private var signOutCleanup: SignOutCleanup? = null
    private var sdkStateClean = false

    @Synchronized
    fun register(identity: Any, origin: String, generation: Long, stateEpoch: Long): Boolean {
        activeOperation = GooglePickerOperation(identity, origin, generation, stateEpoch)
        return true
    }

    @Synchronized
    fun claimLaunch(identity: Any, origin: String, generation: Long, stateEpoch: Long): Boolean {
        val operation = activeOperation ?: return false
        if (
            operation.identity !== identity ||
            operation.origin != origin ||
            operation.generation != generation ||
            operation.stateEpoch != stateEpoch ||
            operation.launchClaimed
        ) {
            return false
        }
        activeOperation = operation.copy(launchClaimed = true)
        return true
    }

    @Synchronized
    fun beginSignOut(
        identity: Any,
        origin: String,
        generation: Long,
        stateEpoch: Long,
        targetAccountId: String? = null,
    ): GooglePickerSignOutDecision {
        val operation = activeOperation ?: return GooglePickerSignOutDecision.REJECT
        if (
            operation.identity !== identity ||
            operation.origin != origin ||
            operation.generation != generation ||
            operation.stateEpoch != stateEpoch
        ) {
            return GooglePickerSignOutDecision.REJECT
        }

        val cleanup = signOutCleanup
        if (cleanup != null) {
            if (cleanup.inFlight || nowMillis() < cleanup.retryAtMillis) {
                return GooglePickerSignOutDecision.WAIT
            }
            cleanup.owner = identity
            cleanup.targetAccountId = targetAccountId ?: cleanup.targetAccountId
            cleanup.attempt += 1
            cleanup.inFlight = true
            return GooglePickerSignOutDecision.START
        }
        if (sdkStateClean) return GooglePickerSignOutDecision.READY

        signOutCleanup = SignOutCleanup(
            owner = identity,
            targetAccountId = targetAccountId,
            attempt = 1,
            retryAtMillis = 0L,
            inFlight = true,
            completion = CompletableDeferred(),
        )
        return GooglePickerSignOutDecision.START
    }

    @Synchronized
    fun beginTargetedSignOut(owner: Any, targetAccountId: String): GooglePickerSignOutDecision {
        val cleanup = signOutCleanup
        if (cleanup != null) {
            if (cleanup.inFlight || nowMillis() < cleanup.retryAtMillis) {
                return GooglePickerSignOutDecision.WAIT
            }
            cleanup.owner = owner
            cleanup.targetAccountId = targetAccountId
            cleanup.attempt += 1
            cleanup.inFlight = true
            return GooglePickerSignOutDecision.START
        }

        sdkStateClean = false
        signOutCleanup = SignOutCleanup(
            owner = owner,
            targetAccountId = targetAccountId,
            attempt = 1,
            retryAtMillis = 0L,
            inFlight = true,
            completion = CompletableDeferred(),
        )
        return GooglePickerSignOutDecision.START
    }

    @Synchronized
    fun completeSignOut(owner: Any, successful: Boolean): GooglePickerSignOutResult? {
        val cleanup = signOutCleanup ?: return null
        if (cleanup.owner !== owner || !cleanup.inFlight) return null
        if (successful) {
            signOutCleanup = null
            sdkStateClean = true
            cleanup.completion.complete(Unit)
            return GooglePickerSignOutResult(activeOperation?.identity)
        }

        cleanup.inFlight = false
        val backoffMillis = (1L shl cleanup.attempt.coerceAtMost(2)) * 1_000L
        cleanup.retryAtMillis = nowMillis() + backoffMillis.coerceAtMost(MAX_BACKOFF_MILLIS)
        return GooglePickerSignOutResult(activeOperation?.identity, cleanup.retryAtMillis)
    }

    @Synchronized
    fun retrySignOut(owner: Any): GooglePickerSignOutDecision {
        val cleanup = signOutCleanup ?: return GooglePickerSignOutDecision.REJECT
        if (cleanup.owner !== owner || cleanup.inFlight || nowMillis() < cleanup.retryAtMillis) {
            return GooglePickerSignOutDecision.WAIT
        }
        cleanup.attempt += 1
        cleanup.inFlight = true
        return GooglePickerSignOutDecision.START
    }

    @Synchronized
    fun cleanupBarrier(): Deferred<Unit>? = signOutCleanup?.completion

    @Synchronized
    fun activeIdentity(): Any? = activeOperation?.identity

    @Synchronized
    fun cleanupTargetAccountId(): String? = signOutCleanup?.targetAccountId

    @Synchronized
    fun cleanupOwner(): Any? = signOutCleanup?.owner

    @Synchronized
    fun markSdkAccountEstablished() {
        sdkStateClean = false
    }

    @Synchronized
    fun markSdkStateClean() {
        sdkStateClean = true
    }

    @Synchronized
    fun hasPendingSignOut(): Boolean = signOutCleanup != null

    @Synchronized
    fun invalidate(): Any? {
        val identity = activeOperation?.identity
        activeOperation = null
        return identity
    }

    @Synchronized
    fun unregister(identity: Any, origin: String, generation: Long) {
        val operation = activeOperation ?: return
        if (
            operation.identity === identity &&
            operation.origin == origin &&
            operation.generation == generation
        ) {
            activeOperation = null
        }
    }

    @Synchronized
    fun isActive(origin: String, generation: Long): Boolean =
        activeOperation?.let {
            it.origin == origin && it.generation == generation
        } == true
}

internal fun isOwnedLegacyGoogleAccount(
    sessionKind: GoogleSessionKind,
    persistedAccountId: String?,
    providerAccountId: String?,
    needsRevalidation: Boolean,
): Boolean =
    !needsRevalidation &&
        sessionKind == GoogleSessionKind.LEGACY &&
        persistedAccountId != null &&
        persistedAccountId == providerAccountId

internal fun shouldCleanupStaleGooglePickerAccount(
    needsRevalidation: Boolean,
    loginPending: Boolean,
    scopesPending: Boolean,
    sessionKind: GoogleSessionKind,
    hasOneTapSession: Boolean,
    hasMicrosoftRefreshToken: Boolean,
): Boolean =
    needsRevalidation &&
        !loginPending &&
        !scopesPending &&
        sessionKind == GoogleSessionKind.NONE &&
        !hasOneTapSession &&
        !hasMicrosoftRefreshToken

package com.auth

internal enum class GoogleRevokeCallbackDecision {
    APPLY_SUCCESS,
    SETTLE_FAILURE,
    SETTLE_ONLY,
    IGNORE,
}

internal data class GoogleRevokeCallback(
    val decision: GoogleRevokeCallbackDecision,
    val stateEpoch: Long?,
    val generation: Long,
)

internal class GoogleRevokeState {
    private var activeGeneration: Long? = null
    private var activeStateEpoch: Long? = null

    fun begin(generation: Long, stateEpoch: Long) {
        activeGeneration = generation
        activeStateEpoch = stateEpoch
    }

    fun inspect(generation: Long, currentStateEpoch: Long, successful: Boolean): GoogleRevokeCallback =
        GoogleRevokeCallback(
            decision = decideGoogleRevokeCallback(
                activeOperationGeneration = activeGeneration,
                callbackGeneration = generation,
                activeStateEpoch = currentStateEpoch,
                capturedStateEpoch = activeStateEpoch,
                successful = successful,
            ),
            stateEpoch = activeStateEpoch,
            generation = generation,
        )

    fun finish(callback: GoogleRevokeCallback): Boolean {
        if (activeGeneration != callback.generation || activeStateEpoch != callback.stateEpoch) {
            return false
        }
        if (callback.decision != GoogleRevokeCallbackDecision.IGNORE) {
            activeGeneration = null
            activeStateEpoch = null
        }
        return true
    }

    fun clear() {
        activeGeneration = null
        activeStateEpoch = null
    }
}

internal enum class GoogleCredentialCleanupDecision {
    RUN,
    WAIT_FOR_COMPLETION,
    SKIP,
}

internal fun decideGoogleRevokeCallback(
    activeOperationGeneration: Long?,
    callbackGeneration: Long,
    activeStateEpoch: Long?,
    capturedStateEpoch: Long?,
    successful: Boolean,
): GoogleRevokeCallbackDecision {
    if (!acceptsAuthCallback(activeOperationGeneration, callbackGeneration)) {
        return GoogleRevokeCallbackDecision.IGNORE
    }
    if (activeStateEpoch != capturedStateEpoch) {
        return GoogleRevokeCallbackDecision.SETTLE_ONLY
    }
    return if (successful) {
        GoogleRevokeCallbackDecision.APPLY_SUCCESS
    } else {
        GoogleRevokeCallbackDecision.SETTLE_FAILURE
    }
}

internal fun decideGoogleCredentialCleanup(
    cleanupGeneration: Long?,
    expectedGeneration: Long,
    cleanupStateEpoch: Long?,
    currentStateEpoch: Long,
    externalCallStarted: Boolean,
): GoogleCredentialCleanupDecision {
    if (cleanupGeneration != expectedGeneration || cleanupStateEpoch == null) {
        return GoogleCredentialCleanupDecision.SKIP
    }
    if (cleanupStateEpoch != currentStateEpoch) {
        return if (externalCallStarted) {
            GoogleCredentialCleanupDecision.WAIT_FOR_COMPLETION
        } else {
            GoogleCredentialCleanupDecision.SKIP
        }
    }
    return if (externalCallStarted) {
        GoogleCredentialCleanupDecision.WAIT_FOR_COMPLETION
    } else {
        GoogleCredentialCleanupDecision.RUN
    }
}

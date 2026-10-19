package com.auth

import java.util.LinkedHashMap

internal const val MAX_KNOWN_MICROSOFT_STATES = 32

internal fun rememberMicrosoftState(
    knownStates: LinkedHashMap<String, Long>,
    state: String,
    generation: Long,
    maxStates: Int = MAX_KNOWN_MICROSOFT_STATES,
) {
    if (state.isEmpty() || generation <= 0L || maxStates <= 0) return
    knownStates[state] = generation
    while (knownStates.size > maxStates) {
        val eldestState = knownStates.entries.firstOrNull()?.key ?: break
        knownStates.remove(eldestState)
    }
}

internal fun microsoftResumeSuppressionFor(
    decision: MicrosoftRedirectDecision,
    currentGeneration: Long?,
): Long? =
    if (decision == MicrosoftRedirectDecision.STALE && currentGeneration != null && currentGeneration > 0L) {
        currentGeneration
    } else {
        null
    }

internal enum class MicrosoftRedirectDecision {
    CURRENT,
    STALE,
    INVALID,
    DUPLICATE,
    NO_ACTIVE_FLOW,
}

internal fun classifyMicrosoftRedirect(
    currentState: String?,
    currentGeneration: Long?,
    callbackState: String?,
    redirectReceived: Boolean,
    knownStates: Map<String, Long>,
): MicrosoftRedirectDecision {
    if (currentState.isNullOrEmpty() || currentGeneration == null || currentGeneration <= 0L) {
        return MicrosoftRedirectDecision.NO_ACTIVE_FLOW
    }
    if (callbackState == currentState) {
        return if (redirectReceived) {
            MicrosoftRedirectDecision.DUPLICATE
        } else {
            MicrosoftRedirectDecision.CURRENT
        }
    }
    val knownGeneration = callbackState?.let(knownStates::get)
    if (knownGeneration != null && knownGeneration != currentGeneration) {
        return MicrosoftRedirectDecision.STALE
    }
    if (redirectReceived) return MicrosoftRedirectDecision.DUPLICATE
    return MicrosoftRedirectDecision.INVALID
}

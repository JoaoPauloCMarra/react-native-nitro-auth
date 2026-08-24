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

/**
 * Pure decision for the Microsoft browser-flow cancel branch in
 * `AuthAdapter.onActivityResumed`. A resume must only cancel the flow when the
 * browser was opened, no `msauth://` redirect has arrived yet, and the
 * resuming activity is not the redirect handler itself
 * (`MicrosoftAuthActivity` resumes immediately after delivering the redirect).
 */
internal fun shouldCancelMicrosoftAuth(
    authInProgress: Boolean,
    browserWasOpened: Boolean,
    redirectReceived: Boolean,
    resumingActivityIsRedirectHandler: Boolean,
    resumeSuppressionGeneration: Long? = null,
    currentGeneration: Long? = null,
): Boolean =
    authInProgress &&
        browserWasOpened &&
        !redirectReceived &&
        !resumingActivityIsRedirectHandler &&
        !(resumeSuppressionGeneration != null && resumeSuppressionGeneration == currentGeneration)

internal fun shouldConsumeMicrosoftResumeSuppression(
    resumeSuppressionGeneration: Long?,
    currentGeneration: Long?,
    resumingActivityIsRedirectHandler: Boolean,
): Boolean =
    !resumingActivityIsRedirectHandler &&
        resumeSuppressionGeneration != null &&
        resumeSuppressionGeneration == currentGeneration

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

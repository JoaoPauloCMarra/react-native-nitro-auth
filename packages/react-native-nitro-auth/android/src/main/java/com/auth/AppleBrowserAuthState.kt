package com.auth

internal fun shouldCancelAppleAuth(
    authInProgress: Boolean,
    browserWasOpened: Boolean,
    callbackReceived: Boolean,
    resumingActivityIsCallbackHandler: Boolean,
    resumeSuppressionGeneration: Long? = null,
    currentGeneration: Long? = null,
): Boolean =
    authInProgress &&
        browserWasOpened &&
        !callbackReceived &&
        !resumingActivityIsCallbackHandler &&
        !(resumeSuppressionGeneration != null && resumeSuppressionGeneration == currentGeneration)

internal fun shouldConsumeAppleResumeSuppression(
    resumeSuppressionGeneration: Long?,
    currentGeneration: Long?,
    resumingActivityIsCallbackHandler: Boolean,
): Boolean =
    !resumingActivityIsCallbackHandler &&
        resumeSuppressionGeneration != null &&
        resumeSuppressionGeneration == currentGeneration

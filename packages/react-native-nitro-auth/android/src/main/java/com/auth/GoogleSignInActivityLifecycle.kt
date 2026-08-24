package com.auth

internal enum class GoogleSignInActivityDecision {
    START,
    WAIT_FOR_RESULT,
    CANCEL_AND_FINISH,
    FINISH,
}

internal enum class GoogleSignInLaunchDecision {
    LAUNCH,
    DEFER,
    IGNORE,
}

internal fun decideGoogleSignInActivity(
    savedInstanceState: Boolean,
    resultDelivered: Boolean,
    launchStarted: Boolean,
): GoogleSignInActivityDecision {
    if (resultDelivered) return GoogleSignInActivityDecision.FINISH
    if (savedInstanceState && launchStarted) return GoogleSignInActivityDecision.WAIT_FOR_RESULT
    return GoogleSignInActivityDecision.START
}

internal fun shouldLaunchGoogleSignIn(
    savedInstanceState: Boolean,
    resultDelivered: Boolean,
    launchStarted: Boolean,
    callbackLaunchToken: Long = 0L,
    currentLaunchToken: Long = callbackLaunchToken,
): Boolean = decideGoogleSignInLaunch(
    lifecycleStateSaved = savedInstanceState,
    resultDelivered = resultDelivered,
    launchStarted = launchStarted,
    callbackLaunchToken = callbackLaunchToken,
    currentLaunchToken = currentLaunchToken,
) == GoogleSignInLaunchDecision.LAUNCH

internal fun decideGoogleSignInLaunch(
    lifecycleStateSaved: Boolean,
    resultDelivered: Boolean,
    launchStarted: Boolean,
    callbackLaunchToken: Long = 0L,
    currentLaunchToken: Long = callbackLaunchToken,
    activityFinishing: Boolean = false,
    activityDestroyed: Boolean = false,
): GoogleSignInLaunchDecision {
    if (resultDelivered || launchStarted || activityFinishing || activityDestroyed) {
        return GoogleSignInLaunchDecision.IGNORE
    }
    if (lifecycleStateSaved) {
        return GoogleSignInLaunchDecision.DEFER
    }
    if (callbackLaunchToken != currentLaunchToken) {
        return GoogleSignInLaunchDecision.IGNORE
    }
    return GoogleSignInLaunchDecision.LAUNCH
}

internal fun shouldSettleGoogleSignInCancellation(
    resultDelivered: Boolean,
    activityFinishing: Boolean,
): Boolean = activityFinishing && !resultDelivered

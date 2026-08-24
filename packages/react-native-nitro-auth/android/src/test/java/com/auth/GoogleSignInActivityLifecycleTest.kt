package com.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class GoogleSignInActivityLifecycleTest {

    @Test
    fun recreationWaitsForThePendingPickerResultWithoutCancellingIt() {
        assertEquals(
            GoogleSignInActivityDecision.WAIT_FOR_RESULT,
            decideGoogleSignInActivity(
                savedInstanceState = true,
                resultDelivered = false,
                launchStarted = true,
            ),
        )
    }

    @Test
    fun firstCreationStartsTheFlow() {
        assertEquals(
            GoogleSignInActivityDecision.START,
            decideGoogleSignInActivity(
                savedInstanceState = false,
                resultDelivered = false,
                launchStarted = false,
            ),
        )
    }

    @Test
    fun savedStateBeforePickerLaunchCanStartTheDeferredPickerOnce() {
        assertEquals(
            GoogleSignInActivityDecision.START,
            decideGoogleSignInActivity(
                savedInstanceState = true,
                resultDelivered = false,
                launchStarted = false,
            ),
        )
    }

    @Test
    fun recreatedActivityRetriesADeferredPickerAfterItResumes() {
        assertEquals(
            GoogleSignInActivityDecision.START,
            decideGoogleSignInActivity(
                savedInstanceState = true,
                resultDelivered = false,
                launchStarted = false,
            ),
        )
        assertEquals(
            GoogleSignInLaunchDecision.LAUNCH,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = false,
                resultDelivered = false,
                launchStarted = false,
                callbackLaunchToken = 5L,
                currentLaunchToken = 5L,
            ),
        )
    }

    @Test
    fun deliveredResultDoesNotStartOrCancelAnotherFlow() {
        assertEquals(
            GoogleSignInActivityDecision.FINISH,
            decideGoogleSignInActivity(
                savedInstanceState = true,
                resultDelivered = true,
                launchStarted = true,
            ),
        )
    }

    @Test
    fun signOutCompletionWhileStateIsSavedIsDeferredEvenWhenItsTokenIsStale() {
        assertEquals(
            GoogleSignInLaunchDecision.DEFER,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = true,
                resultDelivered = false,
                launchStarted = false,
                callbackLaunchToken = 1L,
                currentLaunchToken = 2L,
            ),
        )
    }

    @Test
    fun resumedActivityRetriesTheDeferredPickerWithItsCurrentToken() {
        assertEquals(
            GoogleSignInLaunchDecision.LAUNCH,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = false,
                resultDelivered = false,
                launchStarted = false,
                callbackLaunchToken = 2L,
                currentLaunchToken = 2L,
            ),
        )
    }

    @Test
    fun anOldSignOutCallbackCannotLaunchAfterTheActivityResumes() {
        assertEquals(
            GoogleSignInLaunchDecision.IGNORE,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = false,
                resultDelivered = false,
                launchStarted = false,
                callbackLaunchToken = 1L,
                currentLaunchToken = 2L,
            ),
        )
    }

    @Test
    fun aCurrentCallbackCanLaunchOnlyOnceForTheCurrentActivity() {
        assertEquals(
            GoogleSignInLaunchDecision.LAUNCH,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = false,
                resultDelivered = false,
                launchStarted = false,
                callbackLaunchToken = 3L,
                currentLaunchToken = 3L,
            ),
        )
        assertEquals(
            GoogleSignInLaunchDecision.IGNORE,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = false,
                resultDelivered = false,
                launchStarted = true,
                callbackLaunchToken = 3L,
                currentLaunchToken = 3L,
            ),
        )
    }

    @Test
    fun aDeliveredPickerResultCannotBeRetriedAfterResumeOrRecreation() {
        assertEquals(
            GoogleSignInLaunchDecision.IGNORE,
            decideGoogleSignInLaunch(
                lifecycleStateSaved = false,
                resultDelivered = true,
                launchStarted = false,
                callbackLaunchToken = 4L,
                currentLaunchToken = 4L,
            ),
        )
    }

    @Test
    fun finishingActivitySettlesOnlyAnUndeliveredPicker() {
        assertEquals(
            true,
            shouldSettleGoogleSignInCancellation(
                resultDelivered = false,
                activityFinishing = true,
            ),
        )
        assertEquals(
            false,
            shouldSettleGoogleSignInCancellation(
                resultDelivered = true,
                activityFinishing = true,
            ),
        )
    }
}

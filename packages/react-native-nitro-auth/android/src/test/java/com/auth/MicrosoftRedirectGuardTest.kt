package com.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.LinkedHashMap

class MicrosoftRedirectGuardTest {

    @Test
    fun knownStatesAreBoundedWithoutDroppingRecentStateHistory() {
        val knownStates = LinkedHashMap<String, Long>()

        rememberMicrosoftState(knownStates, "state-a", 1L, maxStates = 2)
        rememberMicrosoftState(knownStates, "state-b", 2L, maxStates = 2)
        rememberMicrosoftState(knownStates, "state-c", 3L, maxStates = 2)

        assertEquals(mapOf("state-b" to 2L, "state-c" to 3L), knownStates)
        assertEquals(
            MicrosoftRedirectDecision.STALE,
            classifyMicrosoftRedirect(
                currentState = "state-c",
                currentGeneration = 3L,
                callbackState = "state-b",
                redirectReceived = false,
                knownStates = knownStates,
            ),
        )
        assertEquals(
            MicrosoftRedirectDecision.INVALID,
            classifyMicrosoftRedirect(
                currentState = "state-c",
                currentGeneration = 3L,
                callbackState = "state-a",
                redirectReceived = false,
                knownStates = knownStates,
            ),
        )
    }

    @Test
    fun lateRedirectFromKnownPreviousGenerationIsIgnored() {
        assertEquals(
            MicrosoftRedirectDecision.STALE,
            classifyMicrosoftRedirect(
                currentState = "state-b",
                currentGeneration = 2L,
                callbackState = "state-a",
                redirectReceived = false,
                knownStates = mapOf("state-a" to 1L, "state-b" to 2L),
            ),
        )
    }

    @Test
    fun currentRedirectIsClaimedOnlyOnce() {
        assertEquals(
            MicrosoftRedirectDecision.CURRENT,
            classifyMicrosoftRedirect(
                currentState = "state-b",
                currentGeneration = 2L,
                callbackState = "state-b",
                redirectReceived = false,
                knownStates = mapOf("state-b" to 2L),
            ),
        )
        assertEquals(
            MicrosoftRedirectDecision.DUPLICATE,
            classifyMicrosoftRedirect(
                currentState = "state-b",
                currentGeneration = 2L,
                callbackState = "state-b",
                redirectReceived = true,
                knownStates = mapOf("state-b" to 2L),
            ),
        )
    }

    @Test
    fun unknownOrMalformedStateIsInvalidForCurrentFlow() {
        assertEquals(
            MicrosoftRedirectDecision.INVALID,
            classifyMicrosoftRedirect(
                currentState = "state-b",
                currentGeneration = 2L,
                callbackState = null,
                redirectReceived = false,
                knownStates = mapOf("state-b" to 2L),
            ),
        )
    }

    @Test
    fun cancelsWhenBrowserWasOpenedAndNoRedirectArrived() {
        assertTrue(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = true,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = false,
            ),
        )
    }

    @Test
    fun doesNotCancelWhenRedirectWasReceived() {
        assertFalse(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = true,
                redirectReceived = true,
                resumingActivityIsRedirectHandler = false,
            ),
        )
    }

    @Test
    fun doesNotCancelWhenResumingActivityIsTheRedirectHandler() {
        assertFalse(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = true,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = true,
            ),
        )
    }

    @Test
    fun doesNotCancelWhenFlowIsNotInProgress() {
        assertFalse(
            shouldCancelMicrosoftAuth(
                authInProgress = false,
                browserWasOpened = true,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = false,
            ),
        )
    }

    @Test
    fun doesNotCancelWhenBrowserWasNeverOpened() {
        assertFalse(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = false,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = false,
            ),
        )
    }

    @Test
    fun staleRedirectActivityFinishIsConsumedByTheNextHostResumeOnly() {
        var suppressionGeneration = microsoftResumeSuppressionFor(
            decision = MicrosoftRedirectDecision.STALE,
            currentGeneration = 2L,
        )
        assertEquals(2L, suppressionGeneration)

        assertFalse(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = true,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = true,
                resumeSuppressionGeneration = suppressionGeneration,
                currentGeneration = 2L,
            ),
        )

        assertTrue(
            shouldConsumeMicrosoftResumeSuppression(
                resumeSuppressionGeneration = suppressionGeneration,
                currentGeneration = 2L,
                resumingActivityIsRedirectHandler = false,
            ),
        )
        assertFalse(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = true,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = false,
                resumeSuppressionGeneration = suppressionGeneration,
                currentGeneration = 2L,
            ),
        )
        suppressionGeneration = null
        assertTrue(
            shouldCancelMicrosoftAuth(
                authInProgress = true,
                browserWasOpened = true,
                redirectReceived = false,
                resumingActivityIsRedirectHandler = false,
                resumeSuppressionGeneration = suppressionGeneration,
                currentGeneration = 2L,
            ),
        )
    }

    @Test
    fun inactiveAndDuplicateRedirectsDoNotInjectState() {
        assertEquals(
            MicrosoftRedirectDecision.NO_ACTIVE_FLOW,
            classifyMicrosoftRedirect(
                currentState = null,
                currentGeneration = null,
                callbackState = "state-a",
                redirectReceived = false,
                knownStates = emptyMap(),
            ),
        )
        assertEquals(
            MicrosoftRedirectDecision.DUPLICATE,
            classifyMicrosoftRedirect(
                currentState = "state-b",
                currentGeneration = 2L,
                callbackState = "state-b",
                redirectReceived = true,
                knownStates = mapOf("state-b" to 2L),
            ),
        )
    }
}

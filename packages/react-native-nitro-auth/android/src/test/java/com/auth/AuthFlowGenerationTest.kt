package com.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthFlowGenerationTest {

    @Test
    fun acceptsOnlyTheCurrentGeneration() {
        assertTrue(acceptsAuthCallback(17L, 17L))
        assertFalse(acceptsAuthCallback(17L, 16L))
        assertFalse(acceptsAuthCallback(null, 17L))
        assertFalse(acceptsAuthCallback(0L, 0L))
    }

    @Test
    fun acceptsOnlyTheCurrentGenerationAndEpoch() {
        assertTrue(acceptsAuthStateCallback(17L, 17L, 4L, 4L, 4L))
        assertFalse(acceptsAuthStateCallback(17L, 17L, 4L, 5L, 4L))
        assertFalse(acceptsAuthStateCallback(17L, 17L, 4L, 4L, 5L))
        assertFalse(acceptsAuthStateCallback(17L, 16L, 4L, 4L, 4L))
    }

    @Test
    fun staleOneTapOrMicrosoftCallbackAfterLogoutCannotCommitState() {
        assertFalse(acceptsAuthStateCallback(17L, 17L, 4L, 4L, 5L))
        assertFalse(acceptsAuthStateCallback(17L, 17L, 4L, 4L, 6L))
    }
}

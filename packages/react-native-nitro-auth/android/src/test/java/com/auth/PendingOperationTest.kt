package com.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingOperationTest {

    @Test
    fun acceptsOnlyTheBegunGenerationAndEpoch() {
        val pending = PendingOperation()
        assertFalse(pending.isPending)
        assertFalse(pending.accepts(17L, 4L))

        pending.begin(17L, 4L)

        assertTrue(pending.isPending)
        assertTrue(pending.accepts(17L, 4L))
        assertFalse(pending.accepts(16L, 4L))
        assertFalse(pending.accepts(17L, 5L))
        assertFalse(pending.accepts(17L, 4L, callbackStateEpoch = 5L))
    }

    @Test
    fun staleCallbackAfterClearCannotBeAccepted() {
        val pending = PendingOperation()
        pending.begin(17L, 4L)

        pending.clear()

        assertNull(pending.generation)
        assertNull(pending.stateEpoch)
        assertFalse(pending.accepts(17L, 4L))
    }

    @Test
    fun clearIfOnlyClearsTheMatchingGeneration() {
        val pending = PendingOperation()
        pending.begin(17L, 4L)

        pending.clearIf(16L)
        assertEquals(17L, pending.generation)

        pending.clearIf(17L)
        assertFalse(pending.isPending)
    }

    @Test
    fun replacementBeginInvalidatesTheEarlierGeneration() {
        val pending = PendingOperation()
        pending.begin(17L, 4L)
        pending.begin(18L, 5L)

        assertFalse(pending.accepts(17L, 5L))
        assertTrue(pending.accepts(18L, 5L))
        assertTrue(pending.matches(18L, 5L))
        assertFalse(pending.matches(18L, 4L))
    }
}

package com.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenExpiryTest {
    private val maxSeconds = Long.MAX_VALUE / 1000
    private val minSeconds = Long.MIN_VALUE / 1000

    @Test
    fun typicalEpochSecondsConvertExactly() {
        assertEquals(0L, epochSecondsToMillisOrNull(0L))
        assertEquals(1_000L, epochSecondsToMillisOrNull(1L))
        assertEquals(1_789_500_000_000L, epochSecondsToMillisOrNull(1_789_500_000L))
        assertEquals(2_147_483_647_000L, epochSecondsToMillisOrNull(Int.MAX_VALUE.toLong()))
        assertEquals(4_294_967_296_000L, epochSecondsToMillisOrNull(4_294_967_296L))
        assertEquals(4_102_444_800_000L, epochSecondsToMillisOrNull(4_102_444_800L))
    }

    @Test
    fun epochSecondsAtTheLongBoundaryNeverWrap() {
        assertEquals(9_223_372_036_854_774_000L, epochSecondsToMillisOrNull(maxSeconds - 1))
        assertEquals(9_223_372_036_854_775_000L, epochSecondsToMillisOrNull(maxSeconds))
        assertNull(epochSecondsToMillisOrNull(maxSeconds + 1))
        assertNull(epochSecondsToMillisOrNull(Long.MAX_VALUE))
        assertNull(epochSecondsToMillisOrNull(Long.MAX_VALUE / 2))
    }

    @Test
    fun negativeEpochSecondsStayNegativeSoThePathStillRejectsThem() {
        assertEquals(-1_000L, epochSecondsToMillisOrNull(-1L))
        assertEquals(-9_223_372_036_854_775_000L, epochSecondsToMillisOrNull(minSeconds))
        for (seconds in listOf(minSeconds - 1, Long.MIN_VALUE / 2, Long.MIN_VALUE)) {
            val millis = epochSecondsToMillisOrNull(seconds)
            assertTrue("$seconds -> $millis", millis != null && millis < 0)
        }
    }

    @Test
    fun typicalExpiresInAddsToTheClock() {
        val now = 1_789_500_000_000L
        assertEquals(now + 1_000L, expirationMillisFromExpiresIn(now, 1L))
        assertEquals(now + 3_600_000L, expirationMillisFromExpiresIn(now, 3_600L))
        assertEquals(now + 86_400_000L * 90, expirationMillisFromExpiresIn(now, 86_400L * 90))
        assertEquals(now + 2_147_483_647_000L, expirationMillisFromExpiresIn(now, Int.MAX_VALUE.toLong()))
        assertEquals(3_600_000L, expirationMillisFromExpiresIn(0L, 3_600L))
    }

    @Test
    fun zeroAndNegativeExpiresInMeanNoExpiry() {
        val now = 1_789_500_000_000L
        for (expiresIn in listOf(0L, -1L, -3_600L, minSeconds, Long.MIN_VALUE)) {
            assertNull(expirationMillisFromExpiresIn(now, expiresIn))
        }
    }

    @Test
    fun expiresInThatCannotBeRepresentedMeansNoExpiryInsteadOfWrapping() {
        val now = 1_789_500_000_000L
        for (expiresIn in listOf(maxSeconds - 1, maxSeconds, maxSeconds + 1, Long.MAX_VALUE / 2, Long.MAX_VALUE)) {
            assertNull("$expiresIn", expirationMillisFromExpiresIn(now, expiresIn))
        }
        assertEquals(9_223_372_036_854_774_000L, expirationMillisFromExpiresIn(0L, maxSeconds - 1))
        assertEquals(9_223_372_036_854_775_000L, expirationMillisFromExpiresIn(0L, maxSeconds))
        assertEquals(Long.MAX_VALUE, expirationMillisFromExpiresIn(807L, maxSeconds))
        assertNull(expirationMillisFromExpiresIn(808L, maxSeconds))
        assertNull(expirationMillisFromExpiresIn(0L, maxSeconds + 1))
        assertNull(expirationMillisFromExpiresIn(Long.MAX_VALUE, 1L))

        val largestSafe = (Long.MAX_VALUE - now) / 1000
        assertEquals(now + largestSafe * 1000, expirationMillisFromExpiresIn(now, largestSafe))
        assertNull(expirationMillisFromExpiresIn(now, largestSafe + 1))
    }
}

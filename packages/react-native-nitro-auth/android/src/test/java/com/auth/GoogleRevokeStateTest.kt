package com.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class GoogleRevokeStateTest {

    @Test
    fun currentSuccessfulCallbackMayApplyCleanup() {
        assertEquals(
            GoogleRevokeCallbackDecision.APPLY_SUCCESS,
            decideGoogleRevokeCallback(11L, 11L, 4L, 4L, successful = true),
        )
    }

    @Test
    fun currentFailureSettlesWithoutCleanup() {
        assertEquals(
            GoogleRevokeCallbackDecision.SETTLE_FAILURE,
            decideGoogleRevokeCallback(11L, 11L, 4L, 4L, successful = false),
        )
    }

    @Test
    fun staleCallbackSettlesNativeOperationWithoutApplyingCleanup() {
        assertEquals(
            GoogleRevokeCallbackDecision.SETTLE_ONLY,
            decideGoogleRevokeCallback(11L, 11L, 5L, 4L, successful = true),
        )
        assertEquals(
            GoogleRevokeCallbackDecision.SETTLE_ONLY,
            decideGoogleRevokeCallback(11L, 11L, 5L, 4L, successful = false),
        )
    }

    @Test
    fun duplicateOrUnknownOperationIsIgnored() {
        assertEquals(
            GoogleRevokeCallbackDecision.IGNORE,
            decideGoogleRevokeCallback(null, 11L, 4L, 4L, successful = true),
        )
        assertEquals(
            GoogleRevokeCallbackDecision.IGNORE,
            decideGoogleRevokeCallback(12L, 11L, 4L, 4L, successful = false),
        )
    }

    @Test
    fun delayedCleanupRunsOnlyForTheSameRevokeAndEpoch() {
        assertEquals(
            GoogleCredentialCleanupDecision.RUN,
            decideGoogleCredentialCleanup(11L, 11L, 4L, 4L, externalCallStarted = false),
        )
        assertEquals(
            GoogleCredentialCleanupDecision.SKIP,
            decideGoogleCredentialCleanup(11L, 12L, 4L, 4L, externalCallStarted = false),
        )
        assertEquals(
            GoogleCredentialCleanupDecision.SKIP,
            decideGoogleCredentialCleanup(11L, 11L, 4L, 5L, externalCallStarted = false),
        )
    }

    @Test
    fun aNewEpochWaitsForAnAlreadyStartedExternalClear() {
        assertEquals(
            GoogleCredentialCleanupDecision.WAIT_FOR_COMPLETION,
            decideGoogleCredentialCleanup(11L, 11L, 4L, 5L, externalCallStarted = true),
        )
    }

    @Test
    fun productionSettlementClearsStaleRevokeAndLeavesReplacementOwnedByB() {
        val callbacks = mutableListOf<Triple<Int?, String?, Long>>()
        AuthAdapter.nativeRevokeResultSink = { code, detail, generation ->
            callbacks += Triple(code, detail, generation)
        }

        val authClass = AuthAdapter::class.java
        val begin = authClass.getDeclaredMethod("beginGoogleRevoke", Long::class.javaPrimitiveType)
        val advance = authClass.getDeclaredMethod("advanceGoogleAuthStateLocked")
        val settle = authClass.getDeclaredMethod(
            "settleGoogleRevoke",
            android.content.Context::class.java,
            Long::class.javaPrimitiveType,
            AuthErrorCode::class.java,
            String::class.java,
            Boolean::class.javaPrimitiveType,
        )
        begin.isAccessible = true
        advance.isAccessible = true
        settle.isAccessible = true

        try {
            begin.invoke(AuthAdapter, 11L)
            advance.invoke(AuthAdapter)
            settle.invoke(AuthAdapter, null, 11L, AuthErrorCode.NETWORK_ERROR, "stale", false)

            begin.invoke(AuthAdapter, 12L)
            settle.invoke(AuthAdapter, null, 11L, AuthErrorCode.NETWORK_ERROR, "late-a", false)
            settle.invoke(AuthAdapter, null, 12L, AuthErrorCode.NETWORK_ERROR, "current-b", false)

            assertEquals(
                listOf(
                    Triple(AuthErrorCode.NETWORK_ERROR.code, "stale", 11L),
                    Triple(AuthErrorCode.NETWORK_ERROR.code, "current-b", 12L),
                ),
                callbacks,
            )
        } finally {
            AuthAdapter.nativeRevokeResultSink = null
            AuthAdapter.cancelPendingOperations()
        }
    }
}

package com.auth

import com.margelo.nitro.com.auth.ProviderFailure
import com.margelo.nitro.com.auth.ProviderRequestRegistry
import com.margelo.nitro.com.auth.ProviderVoidResult
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import com.margelo.nitro.com.auth.AuthErrorCode as NativeAuthErrorCode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
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
    fun productionSettlementClearsStaleRevokeAndLeavesReplacementOwnedByB() {
        val results = mutableListOf<ProviderVoidResult>()
        val first = ProviderRequestRegistry.registerRevocation { results += it }
        val second = ProviderRequestRegistry.registerRevocation { results += it }
        val context = RuntimeEnvironment.getApplication()

        try {
            AuthAdapter.beginGoogleRevoke(first)
            AuthAdapter.advanceGoogleAuthStateLocked()
            AuthAdapter.settleGoogleRevoke(context, first, AuthErrorCode.NETWORK_ERROR, "stale", false)

            AuthAdapter.beginGoogleRevoke(second)
            AuthAdapter.settleGoogleRevoke(context, first, AuthErrorCode.NETWORK_ERROR, "late-a", false)
            AuthAdapter.settleGoogleRevoke(context, second, AuthErrorCode.NETWORK_ERROR, "current-b", false)

            fun failure(detail: String) =
                ProviderVoidResult(ProviderFailure(NativeAuthErrorCode.NETWORK_ERROR, detail))
            assertEquals(listOf(failure("stale"), failure("current-b")), results)
        } finally {
            AuthAdapter.cancelPendingOperations()
            ProviderRequestRegistry.cancelAll()
        }
    }
}

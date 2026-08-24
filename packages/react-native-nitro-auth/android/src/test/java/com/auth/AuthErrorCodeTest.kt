package com.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class AuthErrorCodeTest {

    @Test
    fun wireValuesMirrorTheGeneratedNitroEnum() {
        assertEquals(
            listOf(
                AuthErrorCode.REFRESH_FAILED,
                AuthErrorCode.CANCELLED,
                AuthErrorCode.INTERACTION_REQUIRED,
                AuthErrorCode.TIMEOUT,
                AuthErrorCode.POPUP_BLOCKED,
                AuthErrorCode.NETWORK_ERROR,
                AuthErrorCode.CONFIGURATION_ERROR,
                AuthErrorCode.NOT_SIGNED_IN,
                AuthErrorCode.OPERATION_IN_PROGRESS,
                AuthErrorCode.UNSUPPORTED_PROVIDER,
                AuthErrorCode.INVALID_STATE,
                AuthErrorCode.INVALID_NONCE,
                AuthErrorCode.TOKEN_ERROR,
                AuthErrorCode.NO_ID_TOKEN,
                AuthErrorCode.PARSE_ERROR,
                AuthErrorCode.UNKNOWN,
            ),
            AuthErrorCode.entries.sortedBy { it.code },
        )
    }

    @Test
    fun codesAreDenseAndStartAtZero() {
        assertEquals((0..15).toList(), AuthErrorCode.entries.sortedBy { it.code }.map { it.code })
    }

    @Test
    fun fromCodeFallsBackToUnknownForOutOfRangeValues() {
        assertEquals(AuthErrorCode.CANCELLED, AuthErrorCode.fromCode(1))
        assertEquals(AuthErrorCode.UNKNOWN, AuthErrorCode.fromCode(-1))
        assertEquals(AuthErrorCode.UNKNOWN, AuthErrorCode.fromCode(16))
    }
}

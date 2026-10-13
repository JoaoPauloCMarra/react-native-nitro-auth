package com.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class GoogleStatusCodesTest {
    @Test
    fun mapsSignInAndCommonStatusCodes() {
        assertEquals(AuthErrorCode.CANCELLED, mapGoogleStatusCode(12501))
        assertEquals(AuthErrorCode.CANCELLED, mapGoogleStatusCode(16))
        assertEquals(AuthErrorCode.OPERATION_IN_PROGRESS, mapGoogleStatusCode(12502))
        assertEquals(AuthErrorCode.NOT_SIGNED_IN, mapGoogleStatusCode(4))
        assertEquals(AuthErrorCode.NETWORK_ERROR, mapGoogleStatusCode(7))
        assertEquals(AuthErrorCode.CONFIGURATION_ERROR, mapGoogleStatusCode(8))
        assertEquals(AuthErrorCode.CONFIGURATION_ERROR, mapGoogleStatusCode(10))
        assertEquals(AuthErrorCode.TIMEOUT, mapGoogleStatusCode(15))
        assertEquals(AuthErrorCode.UNKNOWN, mapGoogleStatusCode(9999))
    }
}

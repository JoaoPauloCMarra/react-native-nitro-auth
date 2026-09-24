package com.auth

import android.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MicrosoftJwtDecodeTest {

    @Test
    fun malformedUtf8ClaimIsRejected() {
        val payload = "{\"name\":\"".toByteArray(Charsets.UTF_8) +
            byteArrayOf(0xc3.toByte(), 0x28) +
            "\"}".toByteArray(Charsets.UTF_8)

        assertTrue(MicrosoftAuthConfig.decodeJwt(jwtWithPayload(payload)).isEmpty())
    }

    @Test
    fun supplementaryUnicodeClaimIsPreserved() {
        val payload = "{\"name\":\"Ada 🚀\"}".toByteArray(Charsets.UTF_8)

        assertEquals(
            "Ada 🚀",
            MicrosoftAuthConfig.decodeJwt(jwtWithPayload(payload))["name"],
        )
    }

    private fun jwtWithPayload(payload: ByteArray): String {
        val encoded = Base64.encodeToString(
            payload,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
        )
        return "e30.$encoded.signature"
    }
}

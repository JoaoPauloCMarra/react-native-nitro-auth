package com.auth

import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal object Sha256 {
    private fun digest(value: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.US_ASCII))

    fun hex(value: String): String = digest(value).joinToString("") { byte ->
        (byte.toInt() and 0xff).toString(16).padStart(2, '0')
    }

    fun base64Url(value: String): String =
        Base64.encodeToString(digest(value), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}

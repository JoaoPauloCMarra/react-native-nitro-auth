package com.auth

internal object AuthCrypto {
    @JvmStatic
    external fun sha256Hex(input: String): String
}

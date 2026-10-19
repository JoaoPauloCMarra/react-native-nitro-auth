package com.auth

import com.margelo.nitro.com.auth.AuthProvider

internal data class LoginRequest(
    val provider: AuthProvider,
    val scopes: Array<String>? = null,
    val loginHint: String? = null,
    val nonce: String? = null,
    val useOneTap: Boolean = false,
    val forceAccountPicker: Boolean = false,
    val useLegacyGoogleSignIn: Boolean = false,
    val filterByAuthorizedAccounts: Boolean = false,
    val forceCodeForRefreshToken: Boolean = false,
    val requestVerifiedPhoneNumber: Boolean = false,
    val tenant: String? = null,
    val prompt: String? = null,
    val hostedDomain: String? = null,
)

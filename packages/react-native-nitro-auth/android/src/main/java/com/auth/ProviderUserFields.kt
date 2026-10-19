package com.auth

import com.margelo.nitro.com.auth.AuthProvider

internal class ProviderUserFields(
    val provider: AuthProvider,
    val email: String? = null,
    val name: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val photo: String? = null,
    val idToken: String? = null,
    val accessToken: String? = null,
    val serverAuthCode: String? = null,
    val userId: String? = null,
    val phoneNumber: String? = null,
    val hostedDomain: String? = null,
    val scopes: Array<String>? = null,
    val expirationTime: Long? = null,
)

package com.auth

internal data class MicrosoftTokenCompletion(
    val origin: String,
    val generation: Long,
    val success: Boolean,
    val idToken: String? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val email: String? = null,
    val name: String? = null,
    val scopes: List<String> = emptyList(),
    val expirationTime: Long? = null,
    val code: AuthErrorCode = AuthErrorCode.UNKNOWN,
    val detail: String? = null,
)

internal data class MicrosoftRefreshCompletion(
    val operation: MicrosoftRefreshOperation,
    val generation: Long,
    val stateEpoch: Long,
    val success: Boolean,
    val idToken: String? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val email: String? = null,
    val name: String? = null,
    val scopes: List<String> = emptyList(),
    val expirationTime: Long? = null,
    val code: AuthErrorCode = AuthErrorCode.UNKNOWN,
    val detail: String? = null,
    val clearRefreshToken: Boolean = false,
)

internal enum class MicrosoftRefreshOperation {
    SILENT,
    REFRESH,
}

internal data class MicrosoftRedirectClaim(
    val generation: Long,
    val origin: String,
    val stateIsValid: Boolean,
)

internal data class MicrosoftExchangeSnapshot(
    val origin: String,
    val clientId: String,
    val tenant: String,
    val b2cDomain: String?,
    val verifier: String,
    val scopes: List<String>,
)

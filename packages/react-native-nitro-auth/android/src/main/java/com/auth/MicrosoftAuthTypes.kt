package com.auth

internal data class MicrosoftTokenCompletion(
    val origin: Origin,
    val generation: Long,
    val success: Boolean,
    val idToken: String? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val email: String? = null,
    val name: String? = null,
    val scopes: List<String> = emptyList(),
    val tenant: String? = null,
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
    val origin: Origin,
    val stateIsValid: Boolean,
)

internal data class MicrosoftExchangeSnapshot(
    val origin: Origin,
    val clientId: String,
    val tenant: String,
    val b2cDomain: String?,
    val verifier: String,
    val scopes: List<String>,
)

internal class PendingMicrosoftAuth(
    val origin: Origin,
    val generation: Long,
    val scopes: List<String>,
) {
    @Volatile var browserWasOpened = false
    @Volatile var redirectReceived = false
    @Volatile var verifier: String? = null
    @Volatile var state: String? = null
    @Volatile var nonce: String? = null
    @Volatile var tenant: String? = null
    @Volatile var clientId: String? = null
    @Volatile var b2cDomain: String? = null
}

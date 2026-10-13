package com.auth

internal fun mapGoogleStatusCode(statusCode: Int): AuthErrorCode = when (statusCode) {
    12501, 16 -> AuthErrorCode.CANCELLED
    12502 -> AuthErrorCode.OPERATION_IN_PROGRESS
    4 -> AuthErrorCode.NOT_SIGNED_IN
    7 -> AuthErrorCode.NETWORK_ERROR
    8, 10 -> AuthErrorCode.CONFIGURATION_ERROR
    15 -> AuthErrorCode.TIMEOUT
    else -> AuthErrorCode.UNKNOWN
}

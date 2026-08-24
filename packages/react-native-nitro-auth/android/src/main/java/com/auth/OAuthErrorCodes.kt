// GENERATED FILE - DO NOT EDIT
// Source: scripts/oauth-errors.json
// Regenerate with: bun scripts/generate-oauth-errors.js
package com.auth

internal val OAUTH_ERROR_CODES: Map<String, AuthErrorCode> = mapOf(
    "access_denied" to AuthErrorCode.CANCELLED,
    "consent_required" to AuthErrorCode.INTERACTION_REQUIRED,
    "interaction_required" to AuthErrorCode.INTERACTION_REQUIRED,
    "invalid_client" to AuthErrorCode.CONFIGURATION_ERROR,
    "invalid_grant" to AuthErrorCode.TOKEN_ERROR,
    "invalid_request" to AuthErrorCode.TOKEN_ERROR,
    "invalid_scope" to AuthErrorCode.CONFIGURATION_ERROR,
    "invalid_token" to AuthErrorCode.TOKEN_ERROR,
    "login_required" to AuthErrorCode.INTERACTION_REQUIRED,
    "popup_closed_by_user" to AuthErrorCode.CANCELLED,
    "server_error" to AuthErrorCode.NETWORK_ERROR,
    "temporarily_unavailable" to AuthErrorCode.NETWORK_ERROR,
    "unauthorized_client" to AuthErrorCode.CONFIGURATION_ERROR,
    "user_cancelled" to AuthErrorCode.CANCELLED,
)

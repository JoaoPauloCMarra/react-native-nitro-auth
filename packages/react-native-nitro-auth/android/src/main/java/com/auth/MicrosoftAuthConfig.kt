package com.auth

import android.util.Base64
import android.util.Log
import org.json.JSONObject

internal object MicrosoftAuthConfig {
    private const val TAG = "AuthAdapter"

    /**
     * Canonical OAuth 2.0 / OIDC error-to-AuthErrorCode mapping, backed by the
     * generated table from `scripts/oauth-errors.json`. `docs/error-contract.md`
     * is the documented contract and fixture corpus.
     *
     * `context` selects the operation bucket: "authorize"/"token" surface
     * token/grant failures as `token_error`; "refresh" surfaces them as
     * `refresh_failed`.
     */
    fun mapMicrosoftOAuthError(error: String, context: String = "authorize"): AuthErrorCode {
        val normalized = error.trim().lowercase()
        val code = OAUTH_ERROR_CODES[normalized] ?: AuthErrorCode.UNKNOWN
        return if (context == "refresh" && code == AuthErrorCode.TOKEN_ERROR) {
            AuthErrorCode.REFRESH_FAILED
        } else {
            code
        }
    }

    fun decodeJwt(token: String): Map<String, String> {
        return try {
            val parts = token.split(".")
            if (parts.size < 2) return emptyMap()
            val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
            val json = JSONObject(payload)
            val result = mutableMapOf<String, String>()
            json.keys().forEach { key ->
                val value = json.optString(key)
                if (value.isNotEmpty()) result[key] = value
            }
            result
        } catch (e: Exception) {
            Log.w(TAG, "Failed to decode JWT: ${e.message}")
            emptyMap()
        }
    }

    fun getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?): String? {
        val trimmedTenant = tenant.trim()

        return if (!b2cDomain.isNullOrBlank()) {
            val trimmedDomain = b2cDomain.trim().lowercase()
            if (!isValidMicrosoftDomain(trimmedDomain)) return null
            val b2cTenantPath = getMicrosoftB2cTenantPath(trimmedTenant, trimmedDomain) ?: return null
            "https://$trimmedDomain/$b2cTenantPath/"
        } else {
            if (!isValidMicrosoftTenant(trimmedTenant)) return null
            "https://login.microsoftonline.com/$trimmedTenant/"
        }
    }

    private fun isValidMicrosoftTenant(value: String): Boolean {
        return Regex("^(common|organizations|consumers|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$").matches(value)
    }

    private fun getMicrosoftB2cTenantPath(value: String, domain: String): String? {
        if (isValidMicrosoftB2cTenantPath(value)) return value
        if (!isValidMicrosoftB2cPolicy(value)) return null
        val tenantName = getMicrosoftB2cTenantName(domain) ?: return null
        return "$tenantName.onmicrosoft.com/$value"
    }

    private fun getMicrosoftB2cTenantName(domain: String): String? {
        val suffix = ".b2clogin.com"
        if (!domain.endsWith(suffix)) return null
        val tenantName = domain.removeSuffix(suffix)
        return if (Regex("^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$").matches(tenantName)) tenantName else null
    }

    private fun isValidMicrosoftB2cTenantPath(value: String): Boolean {
        return Regex("^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").matches(value)
    }

    private fun isValidMicrosoftB2cPolicy(value: String): Boolean {
        return Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").matches(value)
    }

    private fun isValidMicrosoftDomain(value: String): Boolean {
        return Regex("^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$").matches(value)
    }
}

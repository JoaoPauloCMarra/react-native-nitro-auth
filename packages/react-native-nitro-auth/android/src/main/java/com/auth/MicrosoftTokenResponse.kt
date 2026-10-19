package com.auth

import org.json.JSONObject

internal class MicrosoftTokenResponse(
    val idToken: String?,
    val accessToken: String?,
    val refreshToken: String?,
    val claims: Map<String, String>,
    val expirationTime: Long?,
) {
    val email: String? get() = claims["preferred_username"] ?: claims["email"]
    val name: String? get() = claims["name"]
}

internal fun parseMicrosoftTokenResponse(responseBody: String, nowMillis: Long = System.currentTimeMillis()): MicrosoftTokenResponse {
    val json = JSONObject(responseBody)
    val idToken = json.optString("id_token").ifEmpty { null }
    return MicrosoftTokenResponse(
        idToken = idToken,
        accessToken = json.optString("access_token").ifEmpty { null },
        refreshToken = json.optString("refresh_token").ifEmpty { null },
        claims = JwtClaims.decode(idToken.orEmpty()),
        expirationTime = expirationMillisFromExpiresIn(nowMillis, json.optLong("expires_in", 0)),
    )
}

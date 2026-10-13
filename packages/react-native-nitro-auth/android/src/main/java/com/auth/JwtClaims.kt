package com.auth

import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

internal object JwtClaims {
    private const val TAG = "AuthAdapter"

    fun decode(token: String): Map<String, String> {
        return try {
            val parts = token.split(".")
            if (parts.size < 2) return emptyMap()
            val payloadBytes = Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
            val payload = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(payloadBytes))
                .toString()
            val json = JSONObject(payload)
            val result = mutableMapOf<String, String>()
            json.keys().forEach { key ->
                val raw = json.opt(key)
                if (raw == null || raw == JSONObject.NULL || raw is JSONObject || raw is JSONArray) return@forEach
                val value = json.optString(key)
                if (value.isNotEmpty()) result[key] = value
            }
            result
        } catch (e: Exception) {
            Log.w(TAG, "Failed to decode JWT: ${e.message}")
            emptyMap()
        }
    }
}

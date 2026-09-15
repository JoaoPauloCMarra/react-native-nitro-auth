package com.auth

import org.json.JSONException
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.FutureTask
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

internal class AppleAndroidBrokerConfig private constructor(
    val baseUrl: String,
    val callbackScheme: String,
) {
    companion object {
        private val callbackSchemePattern = Regex("^[a-z][a-z0-9+.-]{0,63}$")
        private val reservedCallbackSchemes = setOf(
            "http", "https", "javascript", "data", "file", "content", "intent", "about",
        )

        fun parse(baseUrl: String?, callbackScheme: String?): AppleAndroidBrokerConfig? {
            val trimmedBaseUrl = baseUrl?.trim()?.takeIf(String::isNotEmpty) ?: return null
            val trimmedScheme = callbackScheme?.trim()?.takeIf(String::isNotEmpty) ?: return null
            if (!callbackSchemePattern.matches(trimmedScheme) ||
                trimmedScheme in reservedCallbackSchemes
            ) return null

            val uri = try {
                URI(trimmedBaseUrl)
            } catch (_: Exception) {
                return null
            }
            val host = uri.host ?: return null
            if (!uri.scheme.equals("https", ignoreCase = true) ||
                uri.rawUserInfo != null ||
                uri.rawQuery != null ||
                uri.rawFragment != null ||
                uri.port !in -1..65535 ||
                uri.port == 0
            ) return null

            val rawPath = uri.rawPath.orEmpty()
            val decodedPath = try {
                URLDecoder.decode(rawPath, StandardCharsets.UTF_8.name())
            } catch (_: Exception) {
                return null
            }
            if (decodedPath.contains('\\') ||
                decodedPath.split('/').any { it == "." || it == ".." } ||
                Regex("(?i)%2e|%2f|%5c").containsMatchIn(rawPath)
            ) return null

            val canonicalPath = rawPath.trimEnd('/')
            val port = uri.port.takeIf { it >= 0 }?.let { ":$it" }.orEmpty()
            val canonicalUrl = try {
                URI("https://${host.lowercase()}$port$canonicalPath").toASCIIString()
            } catch (_: Exception) {
                return null
            }
            return AppleAndroidBrokerConfig(canonicalUrl, trimmedScheme)
        }
    }
}

internal enum class AppleCallbackDecision {
    CURRENT,
    STALE,
    INVALID,
    DUPLICATE,
    NO_ACTIVE_FLOW,
}

internal fun classifyAppleCallback(
    callbackUrl: String?,
    expectedScheme: String,
    currentAttemptId: String?,
    alreadyHandled: Boolean,
): AppleCallbackDecision {
    if (!isCanonicalAppleAttemptId(currentAttemptId)) {
        return AppleCallbackDecision.NO_ACTIVE_FLOW
    }
    val callbackAttemptId = parseAppleCallbackAttemptId(callbackUrl, expectedScheme)
        ?: return AppleCallbackDecision.INVALID
    if (callbackAttemptId != currentAttemptId) return AppleCallbackDecision.STALE
    return if (alreadyHandled) AppleCallbackDecision.DUPLICATE else AppleCallbackDecision.CURRENT
}

private fun parseAppleCallbackAttemptId(callbackUrl: String?, expectedScheme: String): String? {
    if (callbackUrl.isNullOrBlank()) return null
    val uri = try {
        URI(callbackUrl)
    } catch (_: Exception) {
        return null
    }
    if (!uri.scheme.equals(expectedScheme, ignoreCase = true) ||
        !uri.host.equals("apple", ignoreCase = true) ||
        uri.rawPath != "/callback" ||
        uri.rawUserInfo != null ||
        uri.port != -1 ||
        uri.rawFragment != null
    ) return null

    val query = uri.rawQuery?.split('&')?.singleOrNull() ?: return null
    val separator = query.indexOf('=')
    if (separator < 0) return null
    val key = try {
        URLDecoder.decode(query.substring(0, separator), StandardCharsets.UTF_8.name())
    } catch (_: Exception) {
        return null
    }
    if (key != "attemptId") return null
    val value = try {
        URLDecoder.decode(query.substring(separator + 1), StandardCharsets.UTF_8.name())
    } catch (_: Exception) {
        return null
    }
    return value.takeIf(::isCanonicalAppleAttemptId)
}

private fun isCanonicalAppleAttemptId(value: String?): Boolean {
    if (value.isNullOrEmpty()) return false
    return try {
        java.util.UUID.fromString(value).toString() == value
    } catch (_: IllegalArgumentException) {
        false
    }
}

internal fun isSafeAppleAuthorizationUrl(value: String): Boolean {
    val uri = try {
        URI(value)
    } catch (_: Exception) {
        return false
    }
    return uri.scheme.equals("https", ignoreCase = true) &&
        uri.host.equals("appleid.apple.com", ignoreCase = true) &&
        uri.port in -1..65535 &&
        uri.port == -1 &&
        uri.rawUserInfo == null &&
        uri.rawPath == "/auth/authorize" &&
        uri.rawFragment == null
}

internal data class AppleCodeChallenge(
    val verifier: String,
    val challenge: String,
)

internal fun createAppleCodeChallenge(verifier: String): String {
    require(isSha256Hex(verifier)) { "Apple PKCE verifier must be 32-byte lowercase hexadecimal" }
    return sha256Hex(verifier)
}

internal fun createAppleCodeVerifier(random: SecureRandom = SecureRandom()): String {
    val bytes = ByteArray(32)
    random.nextBytes(bytes)
    return bytes.toLowerHex()
}

internal fun createAppleCodePair(random: SecureRandom = SecureRandom()): AppleCodeChallenge {
    val verifier = createAppleCodeVerifier(random)
    return AppleCodeChallenge(verifier, createAppleCodeChallenge(verifier))
}

private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(StandardCharsets.US_ASCII))
    .toLowerHex()

private fun ByteArray.toLowerHex(): String = joinToString("") { byte ->
    (byte.toInt() and 0xff).toString(16).padStart(2, '0')
}

private fun isSha256Hex(value: String): Boolean = Regex("^[a-f0-9]{64}$").matches(value)

internal data class AppleBrokerAttempt(
    val attemptId: String,
    val authorizationUrl: String,
)

internal data class AppleBrokerCredential(
    val idToken: String,
    val authorizationCode: String,
    val userId: String,
    val email: String?,
    val name: String?,
    val firstName: String?,
    val lastName: String?,
)

internal class AppleAndroidBrokerException(
    val authErrorCode: AuthErrorCode,
    message: String,
) : Exception(message)

internal fun validateAppleScopes(scopes: List<String>): List<String> {
    if (scopes.any { it != "email" && it != "fullName" }) {
        throw AppleAndroidBrokerException(
            AuthErrorCode.CONFIGURATION_ERROR,
            "Apple supports only email and fullName scopes",
        )
    }
    return scopes.distinct()
}

/** Small HTTPS-only transport for the package's server-owned Apple browser flow. */
internal class AppleAndroidBroker(
    private val config: AppleAndroidBrokerConfig,
    private val connectionFactory: (URL) -> HttpURLConnection = { url ->
        url.openConnection() as HttpURLConnection
    },
    private val requestTimeoutMs: Int = REQUEST_TIMEOUT_MS,
) {
    suspend fun start(
        hashedNonce: String,
        codeChallenge: String,
        scopes: List<String>? = null,
    ): AppleBrokerAttempt {
        if (!isSha256Hex(hashedNonce)) {
            throw AppleAndroidBrokerException(AuthErrorCode.INVALID_NONCE, "Apple nonce must be SHA-256 hex")
        }
        if (!isSha256Hex(codeChallenge)) {
            throw AppleAndroidBrokerException(AuthErrorCode.INVALID_STATE, "Invalid Apple PKCE challenge")
        }
        val validatedScopes = scopes?.let(::validateAppleScopes)

        val requestBody = JSONObject()
                .put("nonce", hashedNonce)
                .put("codeChallenge", codeChallenge)
        if (scopes != null) requestBody.put("scopes", JSONArray(validatedScopes))
        val data = post("start", requestBody).optJSONObject("data")
            ?: throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Invalid Apple broker start response")
        val attemptId = data.requiredString("attemptId")
        if (!isCanonicalAppleAttemptId(attemptId)) {
            throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Invalid Apple broker attempt")
        }
        val authorizationUrl = data.requiredString("authorizationUrl")
        if (!isSafeAppleAuthorizationUrl(authorizationUrl)) {
            throw AppleAndroidBrokerException(AuthErrorCode.CONFIGURATION_ERROR, "Apple broker returned an unsafe authorization URL")
        }
        return AppleBrokerAttempt(attemptId, authorizationUrl)
    }

    suspend fun complete(attemptId: String, codeVerifier: String): AppleBrokerCredential {
        if (!isCanonicalAppleAttemptId(attemptId) || !isSha256Hex(codeVerifier)) {
            throw AppleAndroidBrokerException(AuthErrorCode.INVALID_STATE, "Invalid Apple broker attempt")
        }
        val data = post(
            "complete",
            JSONObject()
                .put("attemptId", attemptId)
                .put("codeVerifier", codeVerifier),
        ).optJSONObject("data")
            ?: throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Invalid Apple broker completion response")
        val idToken = data.requiredString("idToken")
        val authorizationCode = data.requiredString("authorizationCode")
        val user = data.optJSONObject("user")
            ?: throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Apple broker omitted user details")
        val userId = user.requiredString("id")
        if (idToken.isBlank() || authorizationCode.isBlank() || userId.isBlank()) {
            throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Apple broker omitted a required credential field")
        }
        return AppleBrokerCredential(
            idToken = idToken,
            authorizationCode = authorizationCode,
            userId = userId,
            email = user.optionalString("email"),
            name = user.optionalString("name"),
            firstName = user.optionalString("firstName"),
            lastName = user.optionalString("lastName"),
        )
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject = suspendCancellableCoroutine { continuation ->
        val endpoint = URL("${config.baseUrl}/$path")
        if (!endpoint.protocol.equals("https", ignoreCase = true)) {
            continuation.resumeWithException(
                AppleAndroidBrokerException(AuthErrorCode.CONFIGURATION_ERROR, "Apple broker must use HTTPS"),
            )
            return@suspendCancellableCoroutine
        }
        val connectionReference = AtomicReference<HttpURLConnection?>()
        val resultDelivered = AtomicBoolean(false)
        val disconnectRequested = AtomicBoolean(false)
        val timeoutReference = AtomicReference<ScheduledFuture<*>?>()
        fun disconnectOffThread() {
            val connection = connectionReference.get() ?: return
            if (disconnectRequested.compareAndSet(false, true)) {
                runCatching {
                    Thread({ runCatching { connection.disconnect() } }, "NitroAuth-AppleBrokerDisconnect")
                        .apply {
                            isDaemon = true
                            start()
                        }
                }
            }
        }
        val task = FutureTask {
            try {
                val response = postBlocking(
                    endpoint,
                    body,
                    connectionReference,
                    resultDelivered,
                    ::disconnectOffThread,
                )
                if (resultDelivered.compareAndSet(false, true)) {
                    timeoutReference.getAndSet(null)?.cancel(false)
                    continuation.resume(response)
                }
            } catch (error: Exception) {
                val wrapped = error as? AppleAndroidBrokerException
                    ?: AppleAndroidBrokerException(AuthErrorCode.NETWORK_ERROR, "Apple broker request failed")
                if (resultDelivered.compareAndSet(false, true)) {
                    timeoutReference.getAndSet(null)?.cancel(false)
                    continuation.resumeWithException(wrapped)
                }
            }
        }
        val timeout = requestTimeouts.schedule({
            if (resultDelivered.compareAndSet(false, true)) {
                timeoutReference.getAndSet(null)?.cancel(false)
                task.cancel(true)
                disconnectOffThread()
                continuation.resumeWithException(
                    AppleAndroidBrokerException(AuthErrorCode.TIMEOUT, "Apple broker request timed out"),
                )
            }
        }, requestTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
        timeoutReference.set(timeout)
        if (resultDelivered.get()) timeout.cancel(false)
        continuation.invokeOnCancellation {
            resultDelivered.compareAndSet(false, true)
            timeoutReference.getAndSet(null)?.cancel(false)
            task.cancel(true)
            disconnectOffThread()
        }
        Thread(task, "NitroAuth-AppleBroker").apply {
            isDaemon = true
            start()
        }
    }

    private fun postBlocking(
        endpoint: URL,
        body: JSONObject,
        connectionReference: AtomicReference<HttpURLConnection?>,
        resultDelivered: AtomicBoolean,
        disconnectOffThread: () -> Unit,
    ): JSONObject {
        val connection = try {
            connectionFactory(endpoint)
        } catch (_: Exception) {
            throw AppleAndroidBrokerException(AuthErrorCode.NETWORK_ERROR, "Could not connect to the Apple broker")
        }
        connectionReference.set(connection)
        try {
            ensureRequestActive(resultDelivered)
            if (!connection.url.protocol.equals("https", ignoreCase = true) ||
                !connection.url.host.equals(endpoint.host, ignoreCase = true) ||
                connection.url.port != endpoint.port
            ) {
                throw AppleAndroidBrokerException(AuthErrorCode.CONFIGURATION_ERROR, "Apple broker connection changed origin")
            }
            connection.connectTimeout = requestTimeoutMs
            connection.readTimeout = requestTimeoutMs
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Cache-Control", "no-store")
            connection.setRequestProperty("Cookie", "")
            connection.setRequestProperty("Authorization", "")
            val requestBytes = body.toString().toByteArray(StandardCharsets.UTF_8)
            connection.setFixedLengthStreamingMode(requestBytes.size)
            ensureRequestActive(resultDelivered)
            connection.outputStream.use {
                ensureRequestActive(resultDelivered)
                it.write(requestBytes)
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.use(::readBoundedResponse).orEmpty()
            val response = try {
                JSONObject(responseBody)
            } catch (_: JSONException) {
                throw AppleAndroidBrokerException(
                    if (status in 200..299) AuthErrorCode.PARSE_ERROR else errorCodeForStatus(status),
                    if (status in 200..299) "Apple broker returned invalid JSON" else "Apple broker request failed",
                )
            }
            if (status !in 200..299) {
                val code = response.optJSONObject("error")?.stringOrNull("code").orEmpty()
                val authErrorCode = errorCodeForBroker(code, status)
                throw AppleAndroidBrokerException(authErrorCode, messageForError(authErrorCode))
            }
            return response
        } catch (error: AppleAndroidBrokerException) {
            throw error
        } catch (error: SocketTimeoutException) {
            throw AppleAndroidBrokerException(AuthErrorCode.TIMEOUT, "Apple broker request timed out")
        } catch (_: IOException) {
            throw AppleAndroidBrokerException(AuthErrorCode.NETWORK_ERROR, "Apple broker request failed")
        } catch (_: Exception) {
            throw AppleAndroidBrokerException(AuthErrorCode.NETWORK_ERROR, "Apple broker request failed")
        } finally {
            try {
                connection.disconnect()
            } finally {
                connectionReference.compareAndSet(connection, null)
            }
        }
    }

    private fun ensureRequestActive(resultDelivered: AtomicBoolean) {
        if (resultDelivered.get()) {
            throw AppleAndroidBrokerException(AuthErrorCode.CANCELLED, "Apple broker request was cancelled")
        }
    }

    private fun readBoundedResponse(input: java.io.InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) {
                throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Apple broker response is too large")
            }
            output.write(buffer, 0, count)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }

    private fun errorCodeForStatus(status: Int): AuthErrorCode = when {
        status >= 500 -> AuthErrorCode.NETWORK_ERROR
        else -> AuthErrorCode.TOKEN_ERROR
    }

    private fun errorCodeForBroker(code: String, status: Int): AuthErrorCode = when (code.uppercase()) {
        "APPLE_AUTHORIZATION_CANCELLED" -> AuthErrorCode.CANCELLED
        "INVALID_NONCE", "APPLE_INVALID_NONCE" -> AuthErrorCode.INVALID_NONCE
        "INVALID_STATE", "APPLE_INVALID_STATE" -> AuthErrorCode.INVALID_STATE
        "TOKEN_ERROR", "APPLE_TOKEN_ERROR" -> AuthErrorCode.TOKEN_ERROR
        else -> errorCodeForStatus(status)
    }

    private fun messageForError(code: AuthErrorCode): String = when (code) {
        AuthErrorCode.CANCELLED -> "Apple authorization was cancelled"
        AuthErrorCode.INVALID_NONCE -> "Apple broker rejected the nonce"
        AuthErrorCode.INVALID_STATE -> "Apple authorization could not be verified"
        AuthErrorCode.TOKEN_ERROR -> "Apple authorization failed"
        AuthErrorCode.NETWORK_ERROR -> "Apple broker request failed"
        else -> "Apple broker request failed"
    }

    private fun JSONObject.requiredString(name: String): String =
        optionalString(name)?.takeIf(String::isNotBlank)
            ?: throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Apple broker omitted a required string field")

    private fun JSONObject.optionalString(name: String): String? {
        if (!has(name) || isNull(name)) return null
        val value = opt(name) as? String
            ?: throw AppleAndroidBrokerException(AuthErrorCode.PARSE_ERROR, "Apple broker returned an invalid string field")
        return value.takeIf(String::isNotBlank)
    }

    private fun JSONObject.stringOrNull(name: String): String? =
        if (!has(name) || isNull(name)) null else opt(name) as? String

    private companion object {
        const val REQUEST_TIMEOUT_MS = 10_000
        const val MAX_RESPONSE_BYTES = 64 * 1024
        val requestTimeouts = ScheduledThreadPoolExecutor(1) { runnable ->
            Thread(runnable, "NitroAuth-AppleBrokerTimeout").apply { isDaemon = true }
        }.apply {
            removeOnCancelPolicy = true
        }
    }
}

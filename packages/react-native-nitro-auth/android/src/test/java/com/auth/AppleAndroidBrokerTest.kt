package com.auth

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking

class AppleAndroidBrokerTest {
    @Test
    fun brokerConfigurationRequiresAnHttpsBaseUrlAndCustomCallbackScheme() {
        val config = AppleAndroidBrokerConfig.parse(
            baseUrl = "https://auth.example.test/mobile/",
            callbackScheme = "nitro-auth-example",
        )

        assertNotNull(config)
        assertEquals("https://auth.example.test/mobile", config?.baseUrl)
        assertEquals("nitro-auth-example", config?.callbackScheme)
        assertNull(AppleAndroidBrokerConfig.parse("http://auth.example.test", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://user:pass@auth.example.test", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test?next=/", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test", "https"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test", "nitro-auth-example/callback"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test", "Nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test", "javascript"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test:0", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test/a/../b", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test/%2e%2e/admin", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test/%2fadmin", "nitro-auth-example"))
        assertNull(AppleAndroidBrokerConfig.parse("https://auth.example.test/%5cadmin", "nitro-auth-example"))
    }

    @Test
    fun authorizationUrlMustStayOnAppleHttpsAuthorizationEndpoint() {
        assertTrue(isSafeAppleAuthorizationUrl("https://appleid.apple.com/auth/authorize?client_id=app"))
        assertFalse(isSafeAppleAuthorizationUrl("http://appleid.apple.com/auth/authorize"))
        assertFalse(isSafeAppleAuthorizationUrl("https://appleid.apple.com.attacker.test/auth/authorize"))
        assertFalse(isSafeAppleAuthorizationUrl("https://attacker.test/auth/authorize"))
        assertFalse(isSafeAppleAuthorizationUrl("https://appleid.apple.com/redirect"))
    }

    @Test
    fun callbackMustMatchExactSchemePathAndCurrentUuidAttemptAndCanOnlyBeClaimedOnce() {
        val activeAttempt = "047168d4-5b95-4ea2-9b46-193bc1ea0fc8"
        val otherAttempt = "efc90a19-0a12-4aca-8b8f-68aaddd22c8a"
        val callback = "nitro-auth-example://apple/callback?attemptId=$activeAttempt"

        assertEquals(
            AppleCallbackDecision.CURRENT,
            classifyAppleCallback(callback, "nitro-auth-example", activeAttempt, alreadyHandled = false),
        )
        assertEquals(
            AppleCallbackDecision.DUPLICATE,
            classifyAppleCallback(callback, "nitro-auth-example", activeAttempt, alreadyHandled = true),
        )
        assertEquals(
            AppleCallbackDecision.STALE,
            classifyAppleCallback(
                "nitro-auth-example://apple/callback?attemptId=$otherAttempt",
                "nitro-auth-example",
                activeAttempt,
                alreadyHandled = false,
            ),
        )
        assertEquals(
            AppleCallbackDecision.INVALID,
            classifyAppleCallback(
                "nitro-auth-example://evil/callback?attemptId=$activeAttempt",
                "nitro-auth-example",
                activeAttempt,
                alreadyHandled = false,
            ),
        )
        assertEquals(
            AppleCallbackDecision.INVALID,
            classifyAppleCallback(
                "nitro-auth-example://apple/callback?attemptId=$activeAttempt&id_token=secret",
                "nitro-auth-example",
                activeAttempt,
                alreadyHandled = false,
            ),
        )
        assertEquals(
            AppleCallbackDecision.NO_ACTIVE_FLOW,
            classifyAppleCallback(callback, "nitro-auth-example", null, alreadyHandled = false),
        )
    }

    @Test
    fun pkceVerifierIsRandomHexAndChallengeIsSha256HexOfVerifier() {
        val code = createAppleCodePair()

        assertTrue(Regex("^[a-f0-9]{64}$").matches(code.verifier))
        assertTrue(Regex("^[a-f0-9]{64}$").matches(code.challenge))
        assertEquals(createAppleCodeChallenge(code.verifier), code.challenge)
    }

    @Test
    fun browserReturnCancelsOnlyAnOpenedUnclaimedAppleFlow() {
        assertTrue(
            shouldCancelAppleAuth(
                authInProgress = true,
                browserWasOpened = true,
                callbackReceived = false,
                resumingActivityIsCallbackHandler = false,
            ),
        )
        assertFalse(
            shouldCancelAppleAuth(
                authInProgress = true,
                browserWasOpened = true,
                callbackReceived = true,
                resumingActivityIsCallbackHandler = false,
            ),
        )
        assertFalse(
            shouldCancelAppleAuth(
                authInProgress = true,
                browserWasOpened = true,
                callbackReceived = false,
                resumingActivityIsCallbackHandler = true,
            ),
        )
        assertFalse(
            shouldCancelAppleAuth(
                authInProgress = true,
                browserWasOpened = true,
                callbackReceived = false,
                resumingActivityIsCallbackHandler = false,
                resumeSuppressionGeneration = 8L,
                currentGeneration = 8L,
            ),
        )
        assertFalse(
            shouldCancelAppleAuth(
                authInProgress = true,
                browserWasOpened = false,
                callbackReceived = false,
                resumingActivityIsCallbackHandler = false,
            ),
        )
    }

    @Test
    fun staleCallbackResumeSuppressionIsConsumedOnlyByTheCurrentHost() {
        assertTrue(
            shouldConsumeAppleResumeSuppression(
                resumeSuppressionGeneration = 8L,
                currentGeneration = 8L,
                resumingActivityIsCallbackHandler = false,
            ),
        )
        assertFalse(
            shouldConsumeAppleResumeSuppression(
                resumeSuppressionGeneration = 8L,
                currentGeneration = 8L,
                resumingActivityIsCallbackHandler = true,
            ),
        )
        assertFalse(
            shouldConsumeAppleResumeSuppression(
                resumeSuppressionGeneration = 7L,
                currentGeneration = 8L,
                resumingActivityIsCallbackHandler = false,
            ),
        )
    }
}

@RunWith(RobolectricTestRunner::class)
class AppleAndroidBrokerTransportTest {
    private val config = requireNotNull(
        AppleAndroidBrokerConfig.parse("https://auth.example.test/mobile", "nitro-auth-example"),
    )

    @Test
    fun startPostsOnlyNonceChallengeAndValidatedScopesWithoutFollowingRedirects() = runBlocking {
        val attemptId = "047168d4-5b95-4ea2-9b46-193bc1ea0fc8"
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 200,
            responseBody = """{"data":{"attemptId":"$attemptId","authorizationUrl":"https://appleid.apple.com/auth/authorize?client_id=example"}}""",
        )
        val broker = AppleAndroidBroker(config, connectionFactory = { connection })

        val attempt = broker.start(
            hashedNonce = "a".repeat(64),
            codeChallenge = "b".repeat(64),
            scopes = listOf("email", "fullName"),
        )

        val request = JSONObject(connection.requestBody.toString(StandardCharsets.UTF_8.name()))
        assertEquals(attemptId, attempt.attemptId)
        assertEquals("https://appleid.apple.com/auth/authorize?client_id=example", attempt.authorizationUrl)
        assertEquals("POST", connection.requestMethod)
        assertEquals("/mobile/start", connection.url.path)
        assertFalse(connection.instanceFollowRedirects)
        assertEquals("a".repeat(64), request.getString("nonce"))
        assertEquals("b".repeat(64), request.getString("codeChallenge"))
        assertEquals("email", request.getJSONArray("scopes").getString(0))
        assertEquals("fullName", request.getJSONArray("scopes").getString(1))
        assertFalse(request.has("idToken"))
        assertFalse(request.has("authorizationCode"))
        assertTrue(connection.getRequestProperty("Cookie").isNullOrEmpty())
        assertTrue(connection.getRequestProperty("Authorization").isNullOrEmpty())
        assertTrue(connection.disconnected)
    }

    @Test
    fun completeMapsCredentialFieldsAndPostsOnlyAttemptAndVerifier() = runBlocking {
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/complete"),
            status = 200,
            responseBody = """{"data":{"idToken":"id-token","authorizationCode":"auth-code","user":{"id":"user-id","email":"user@example.test","name":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace"}}}""",
        )
        val broker = AppleAndroidBroker(config, connectionFactory = { connection })

        val credential = broker.complete(
            attemptId = "047168d4-5b95-4ea2-9b46-193bc1ea0fc8",
            codeVerifier = "c".repeat(64),
        )

        val request = JSONObject(connection.requestBody.toString(StandardCharsets.UTF_8.name()))
        assertEquals("user-id", credential.userId)
        assertEquals("id-token", credential.idToken)
        assertEquals("auth-code", credential.authorizationCode)
        assertEquals("user@example.test", credential.email)
        assertEquals("Ada Lovelace", credential.name)
        assertEquals("Ada", credential.firstName)
        assertEquals("Lovelace", credential.lastName)
        assertEquals("047168d4-5b95-4ea2-9b46-193bc1ea0fc8", request.getString("attemptId"))
        assertEquals("c".repeat(64), request.getString("codeVerifier"))
        assertFalse(request.has("idToken"))
        assertFalse(request.has("authorizationCode"))
    }

    @Test
    fun redirectResponseIsRejectedWithoutFollowingIt() = runBlocking {
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 302,
            responseBody = """{"error":{"code":"APPLE_TOKEN_ERROR","message":"private redirect details"}}""",
        )

        val error = captureBrokerError {
            AppleAndroidBroker(config, connectionFactory = { connection }).start("a".repeat(64), "b".repeat(64))
        }

        assertFalse(connection.instanceFollowRedirects)
        assertEquals(AuthErrorCode.TOKEN_ERROR, error.authErrorCode)
        assertFalse(error.message.orEmpty().contains("private redirect details"))
    }

    @Test
    fun oversizedMalformedAndNullRequiredResponsesAreRejected() = runBlocking {
        val oversized = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 200,
            responseBody = "x".repeat(64 * 1024 + 1),
        )
        val oversizedError = captureBrokerError {
            AppleAndroidBroker(config, connectionFactory = { oversized }).start("a".repeat(64), "b".repeat(64))
        }
        assertEquals(AuthErrorCode.PARSE_ERROR, oversizedError.authErrorCode)
        assertEquals("Apple broker response is too large", oversizedError.message)

        val malformed = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 200,
            responseBody = "not json",
        )
        val malformedError = captureBrokerError {
            AppleAndroidBroker(config, connectionFactory = { malformed }).start("a".repeat(64), "b".repeat(64))
        }
        assertEquals(AuthErrorCode.PARSE_ERROR, malformedError.authErrorCode)

        val nullAttempt = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 200,
            responseBody = """{"data":{"attemptId":null,"authorizationUrl":"https://appleid.apple.com/auth/authorize"}}""",
        )
        val nullAttemptError = captureBrokerError {
            AppleAndroidBroker(config, connectionFactory = { nullAttempt }).start("a".repeat(64), "b".repeat(64))
        }
        assertEquals(AuthErrorCode.PARSE_ERROR, nullAttemptError.authErrorCode)

        val nullUserId = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/complete"),
            status = 200,
            responseBody = """{"data":{"idToken":"id-token","authorizationCode":"auth-code","user":{"id":null}}}""",
        )
        val nullUserIdError = captureBrokerError {
            AppleAndroidBroker(config, connectionFactory = { nullUserId }).complete(
                "047168d4-5b95-4ea2-9b46-193bc1ea0fc8",
                "c".repeat(64),
            )
        }
        assertEquals(AuthErrorCode.PARSE_ERROR, nullUserIdError.authErrorCode)
    }

    @Test
    fun brokerCancellationErrorMapsToCancelledWithoutExposingServerMessage() = runBlocking {
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 409,
            responseBody = """{"error":{"code":"APPLE_AUTHORIZATION_CANCELLED","message":"private account details"}}""",
        )

        val error = captureBrokerError {
            AppleAndroidBroker(config, connectionFactory = { connection }).start("a".repeat(64), "b".repeat(64))
        }

        assertEquals(AuthErrorCode.CANCELLED, error.authErrorCode)
        assertEquals("Apple authorization was cancelled", error.message)
        assertFalse(error.message.orEmpty().contains("private account details"))
    }

    @Test
    fun timedOutConnectionCreationNeverWritesARequest() {
        val factoryStarted = CountDownLatch(1)
        val factoryRelease = CountDownLatch(1)
        val workerThread = AtomicReference<Thread?>()
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"), 200, "{}",
        )
        val call = FutureTask {
            runBlocking {
                captureBrokerError {
                    AppleAndroidBroker(config, connectionFactory = {
                        workerThread.set(Thread.currentThread())
                        factoryStarted.countDown()
                        while (factoryRelease.count > 0) {
                            try {
                                factoryRelease.await()
                            } catch (_: InterruptedException) {
                            }
                        }
                        connection
                    }, requestTimeoutMs = 500).start("a".repeat(64), "b".repeat(64))
                }
            }
        }
        val caller = Thread(call, "AppleBrokerFactoryTestCaller").apply { start() }
        try {
            assertTrue(factoryStarted.await(2, TimeUnit.SECONDS))
            assertEquals(AuthErrorCode.TIMEOUT, call.get(2, TimeUnit.SECONDS).authErrorCode)
            factoryRelease.countDown()
            workerThread.get()?.join(1_000)
            assertFalse(workerThread.get()?.isAlive == true)
            assertEquals(0, connection.requestBody.size())
        } finally {
            factoryRelease.countDown()
            call.cancel(true)
            caller.join(1_000)
        }
    }

    @Test
    fun timeoutIsDeliveredBeforeDisconnectFinishesAndDisconnectStaysOffCallerAndTimerThreads() {
        val requestStarted = CountDownLatch(1)
        val responseRelease = CountDownLatch(1)
        val disconnectRelease = CountDownLatch(1)
        val disconnectThread = AtomicReference<Thread?>()
        val callerThread = AtomicReference<Thread?>()
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 200,
            responseBody = "{}",
            responseCodeBlock = {
                requestStarted.countDown()
                try {
                    responseRelease.await()
                } catch (error: InterruptedException) {
                    throw java.io.IOException("request interrupted", error)
                }
                200
            },
            disconnectBlock = {
                disconnectThread.compareAndSet(null, Thread.currentThread())
                disconnectRelease.await()
            },
        )
        val call = FutureTask {
            callerThread.set(Thread.currentThread())
            runBlocking {
                captureBrokerError {
                    AppleAndroidBroker(config, connectionFactory = { connection }, requestTimeoutMs = 500)
                        .start("a".repeat(64), "b".repeat(64))
                }
            }
        }
        val caller = Thread(call, "AppleBrokerTimeoutTestCaller").apply { start() }

        try {
            assertTrue(requestStarted.await(2, TimeUnit.SECONDS))
            val error = call.get(2, TimeUnit.SECONDS)

            assertEquals(AuthErrorCode.TIMEOUT, error.authErrorCode)
            assertTrue(disconnectThread.get() != null)
            assertTrue(disconnectThread.get() !== callerThread.get())
            assertFalse(disconnectThread.get()?.name == "NitroAuth-AppleBrokerTimeout")
            assertEquals(1L, disconnectRelease.count)
        } finally {
            responseRelease.countDown()
            disconnectRelease.countDown()
            call.cancel(true)
            caller.join(1_000)
        }
    }

    @Test
    fun coroutineCancellationSchedulesDisconnectOffTheCancellingCaller() {
        val requestStarted = CountDownLatch(1)
        val responseRelease = CountDownLatch(1)
        val disconnectRelease = CountDownLatch(1)
        val disconnectEntered = CountDownLatch(1)
        val disconnectThread = AtomicReference<Thread?>()
        val cancellingThread = AtomicReference<Thread?>()
        val activeJob = AtomicReference<Job?>()
        val connection = FakeHttpURLConnection(
            URL("https://auth.example.test/mobile/start"),
            status = 200,
            responseBody = "{}",
            responseCodeBlock = {
                requestStarted.countDown()
                try {
                    responseRelease.await()
                } catch (error: InterruptedException) {
                    throw java.io.IOException("request interrupted", error)
                }
                200
            },
            disconnectBlock = {
                disconnectThread.compareAndSet(null, Thread.currentThread())
                disconnectEntered.countDown()
                disconnectRelease.await()
            },
        )
        val call = FutureTask {
            try {
                runBlocking {
                    activeJob.set(coroutineContext[Job])
                    AppleAndroidBroker(config, connectionFactory = { connection }, requestTimeoutMs = 5_000)
                        .start("a".repeat(64), "b".repeat(64))
                }
                false
            } catch (_: java.util.concurrent.CancellationException) {
                true
            }
        }
        val caller = Thread(call, "AppleBrokerCancelTestCaller").apply { start() }

        try {
            assertTrue(requestStarted.await(2, TimeUnit.SECONDS))
            val cancellation = FutureTask<Unit> {
                cancellingThread.set(Thread.currentThread())
                checkNotNull(activeJob.get()).cancel()
            }
            Thread(cancellation, "AppleBrokerCancelTestCanceller").apply { start() }
            cancellation.get(1, TimeUnit.SECONDS)

            assertTrue(call.get(1, TimeUnit.SECONDS))
            assertTrue(disconnectEntered.await(1, TimeUnit.SECONDS))
            assertTrue(disconnectThread.get() !== cancellingThread.get())
            assertFalse(disconnectThread.get()?.name == "NitroAuth-AppleBrokerTimeout")
            assertEquals(1L, disconnectRelease.count)
        } finally {
            responseRelease.countDown()
            disconnectRelease.countDown()
            call.cancel(true)
            caller.join(1_000)
        }
    }

    private suspend fun captureBrokerError(block: suspend () -> Unit): AppleAndroidBrokerException {
        try {
            block()
        } catch (error: AppleAndroidBrokerException) {
            return error
        }
        throw AssertionError("Expected AppleAndroidBrokerException")
    }

    private class FakeHttpURLConnection(
        url: URL,
        private val status: Int,
        private val responseBody: String,
        private val responseCodeBlock: (() -> Int)? = null,
        private val disconnectBlock: (() -> Unit)? = null,
    ) : HttpURLConnection(url) {
        val requestBody = ByteArrayOutputStream()
        var disconnected = false
            private set

        override fun connect() = Unit

        override fun disconnect() {
            disconnected = true
            disconnectBlock?.invoke()
        }

        override fun usingProxy(): Boolean = false

        override fun getOutputStream(): ByteArrayOutputStream = requestBody

        override fun getResponseCode(): Int = responseCodeBlock?.invoke() ?: status

        override fun getInputStream() =
            ByteArrayInputStream(responseBody.toByteArray(StandardCharsets.UTF_8))

        override fun getErrorStream() =
            if (status in 200..299) null
            else ByteArrayInputStream(responseBody.toByteArray(StandardCharsets.UTF_8))
    }
}

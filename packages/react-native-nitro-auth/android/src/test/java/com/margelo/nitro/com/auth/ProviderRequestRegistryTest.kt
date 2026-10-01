package com.margelo.nitro.com.auth

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class ProviderRequestRegistryTest {
    private val users = mutableListOf<ProviderUserResult>()
    private val tokens = mutableListOf<ProviderTokenResult>()
    private val revocations = mutableListOf<ProviderVoidResult>()

    @After
    fun drainRegistry() {
        ProviderRequestRegistry.cancelAll()
    }

    private fun registerUser(origin: String = "login"): Long =
        ProviderRequestRegistry.registerUser(origin) { users.add(it) }

    private fun success(
        id: Long,
        origin: String = "login",
        provider: String = "google",
        serverAuthCode: String? = "server-code",
        scopes: Array<String>? = arrayOf("email"),
        expirationTime: Long? = 1_789_500_000_000L,
    ): Boolean = ProviderRequestRegistry.loginSuccess(
        origin, provider, "user@example.com", "User Name", "User", "Name", "https://photo", "id-token",
        "access-token", serverAuthCode, "user-id", "+15550100", "example.com", scopes, expirationTime, id,
    )

    @Test
    fun generatedErrorCodesMirrorThePackageEnum() {
        assertEquals(
            com.auth.AuthErrorCode.entries.map { it.name to it.code },
            AuthErrorCode.entries.map { it.name to it.value },
        )
        assertEquals(
            com.auth.AuthErrorCode.entries.map { it.wire },
            AuthErrorCode.entries.map { it.name.lowercase() },
        )
    }

    @Test
    fun everyErrorCodeIntegerReachesTheTypedFailure() {
        for (code in AuthErrorCode.entries) {
            val login = registerUser()
            assertTrue(ProviderRequestRegistry.loginError("login", code.value, "detail-${code.value}", login))
            assertEquals(ProviderUserResult(null, ProviderFailure(code, "detail-${code.value}")), users.last())

            val refresh = ProviderRequestRegistry.registerTokens { tokens.add(it) }
            assertTrue(ProviderRequestRegistry.refreshError(code.value, null, refresh))
            assertEquals(ProviderTokenResult(null, ProviderFailure(code, null)), tokens.last())

            val revoke = ProviderRequestRegistry.registerRevocation { revocations.add(it) }
            assertTrue(ProviderRequestRegistry.revokeResult(code.value, "", revoke))
            assertEquals(ProviderVoidResult(ProviderFailure(code, "")), revocations.last())
        }
        assertEquals(AuthErrorCode.entries.size, users.size)
    }

    @Test
    fun outOfRangeErrorCodesBecomeUnknownAndHostileDetailsPassThrough() {
        val details = listOf(null, "", "bad\u0000byte", "x".repeat(1_000_000), "🚀")
        for ((index, code) in listOf(-1, 16, 17, 255, Int.MAX_VALUE, Int.MIN_VALUE).withIndex()) {
            val detail = details[index % details.size]
            val id = registerUser()
            assertTrue(ProviderRequestRegistry.loginError("login", code, detail, id))
            assertEquals(AuthErrorCode.UNKNOWN, users.last().failure?.code)
            assertEquals(detail, users.last().failure?.detail)
            assertNull(users.last().user)
        }
    }

    @Test
    fun userRequestSettlesExactlyOnce() {
        val id = registerUser()
        assertTrue(ProviderRequestRegistry.loginError("login", AuthErrorCode.CANCELLED.value, null, id))
        assertFalse(ProviderRequestRegistry.loginError("login", AuthErrorCode.NETWORK_ERROR.value, null, id))
        assertFalse(success(id))
        ProviderRequestRegistry.cancelAll()
        assertEquals(1, users.size)
        assertEquals(AuthErrorCode.CANCELLED, users.single().failure?.code)

        val succeeded = registerUser()
        assertTrue(success(succeeded))
        assertFalse(success(succeeded))
        assertFalse(ProviderRequestRegistry.loginError("login", AuthErrorCode.TIMEOUT.value, null, succeeded))
        assertEquals(2, users.size)
        assertNull(users.last().failure)
    }

    @Test
    fun callbackFromAnotherOriginOrUnknownGenerationIsIgnoredWithoutConsumingTheRequest() {
        val id = registerUser("scopes")
        assertFalse(ProviderRequestRegistry.loginError("login", AuthErrorCode.CANCELLED.value, null, id))
        assertFalse(success(id, origin = "silent"))
        assertFalse(ProviderRequestRegistry.loginError("", AuthErrorCode.CANCELLED.value, null, id))
        for (unknown in listOf(0L, -1L, id + 1_000_000L, Long.MAX_VALUE, Long.MIN_VALUE)) {
            assertFalse(ProviderRequestRegistry.loginError("scopes", AuthErrorCode.CANCELLED.value, null, unknown))
            assertFalse(success(unknown, origin = "scopes"))
            assertFalse(ProviderRequestRegistry.refreshError(AuthErrorCode.CANCELLED.value, null, unknown))
            assertFalse(ProviderRequestRegistry.refreshSuccess("id", "access", null, unknown))
            assertFalse(ProviderRequestRegistry.revokeResult(null, null, unknown))
        }
        assertTrue(users.isEmpty())

        assertTrue(success(id, origin = "scopes"))
        assertEquals(1, users.size)
    }

    @Test
    fun requestKindsDoNotShareIdentifiers() {
        val user = registerUser()
        val token = ProviderRequestRegistry.registerTokens { tokens.add(it) }
        val revocation = ProviderRequestRegistry.registerRevocation { revocations.add(it) }
        assertTrue(user < token && token < revocation)

        assertFalse(ProviderRequestRegistry.refreshError(AuthErrorCode.UNKNOWN.value, null, user))
        assertFalse(ProviderRequestRegistry.revokeResult(null, null, token))
        assertFalse(ProviderRequestRegistry.loginError("login", AuthErrorCode.UNKNOWN.value, null, revocation))
        assertTrue(users.isEmpty() && tokens.isEmpty() && revocations.isEmpty())

        assertTrue(ProviderRequestRegistry.revokeResult(null, "ignored", revocation))
        assertEquals(ProviderVoidResult(null), revocations.single())
        assertFalse(ProviderRequestRegistry.revokeResult(null, null, revocation))
    }

    @Test
    fun loginSuccessMapsEveryFieldAndOnlyAppleGetsAnAuthorizationCode() {
        val google = registerUser()
        assertTrue(success(google))
        val user = users.last().user!!
        assertNull(users.last().failure)
        assertEquals(AuthProvider.GOOGLE, user.provider)
        assertEquals("user@example.com", user.email)
        assertEquals("User Name", user.name)
        assertEquals("User", user.firstName)
        assertEquals("Name", user.lastName)
        assertEquals("https://photo", user.photo)
        assertEquals("id-token", user.idToken)
        assertEquals("access-token", user.accessToken)
        assertNull(user.refreshToken)
        assertEquals("server-code", user.serverAuthCode)
        assertNull(user.authorizationCode)
        assertEquals("user-id", user.userId)
        assertEquals("+15550100", user.phoneNumber)
        assertEquals("example.com", user.hostedDomain)
        assertArrayEquals(arrayOf("email"), user.scopes)
        assertEquals(1_789_500_000_000.0, user.expirationTime!!, 0.0)
        assertNull(user.underlyingError)

        val apple = registerUser()
        assertTrue(success(apple, provider = "apple", scopes = null, expirationTime = null))
        assertEquals(AuthProvider.APPLE, users.last().user?.provider)
        assertEquals("server-code", users.last().user?.authorizationCode)
        assertEquals("server-code", users.last().user?.serverAuthCode)
        assertNull(users.last().user?.scopes)
        assertNull(users.last().user?.expirationTime)

        val microsoft = registerUser()
        assertTrue(success(microsoft, provider = "microsoft", serverAuthCode = null))
        assertEquals(AuthProvider.MICROSOFT, users.last().user?.provider)
        assertNull(users.last().user?.authorizationCode)
    }

    @Test
    fun expirationBoundariesAreKeptOrRejectedBeforeTheNumericCast() {
        for (valid in listOf(0L, 1L, 2_147_483_647L, 4_294_967_296L, 4_102_444_800_000L, Long.MAX_VALUE)) {
            val id = registerUser()
            assertTrue(success(id, expirationTime = valid))
            assertEquals(valid.toDouble(), users.last().user!!.expirationTime!!, 0.0)
        }
        for (invalid in listOf(-1L, -1_000L, Long.MIN_VALUE)) {
            val id = registerUser()
            assertFalse(success(id, expirationTime = invalid))
            assertEquals(ProviderUserResult(null, ProviderFailure(AuthErrorCode.PARSE_ERROR, null)), users.last())
            assertFalse(success(id))
        }
    }

    @Test
    fun unknownProviderNamesAreAParseErrorAndStillConsumeTheRequest() {
        for (provider in listOf("", " ", "GOOGLE", "Google", "facebook", "google ", "apple\u0000", "x".repeat(100_000))) {
            val id = registerUser()
            assertFalse(success(id, provider = provider))
            assertEquals(ProviderUserResult(null, ProviderFailure(AuthErrorCode.PARSE_ERROR, null)), users.last())
            assertFalse(ProviderRequestRegistry.loginError("login", AuthErrorCode.CANCELLED.value, null, id))
        }
    }

    @Test
    fun refreshResultsSettleOnceAndKeepNullableFields() {
        val id = ProviderRequestRegistry.registerTokens { tokens.add(it) }
        assertTrue(ProviderRequestRegistry.refreshSuccess("id-token", "access-token", 1_789_500_000_000L, id))
        assertFalse(ProviderRequestRegistry.refreshSuccess("other", "other", null, id))
        assertFalse(ProviderRequestRegistry.refreshError(AuthErrorCode.NETWORK_ERROR.value, null, id))
        val settled = tokens.single()
        assertNull(settled.failure)
        assertEquals("access-token", settled.tokens?.accessToken)
        assertEquals("id-token", settled.tokens?.idToken)
        assertNull(settled.tokens?.refreshToken)
        assertEquals(1_789_500_000_000.0, settled.tokens!!.expirationTime!!, 0.0)

        val empty = ProviderRequestRegistry.registerTokens { tokens.add(it) }
        assertTrue(ProviderRequestRegistry.refreshSuccess(null, null, null, empty))
        assertNotNull(tokens.last().tokens)
        assertNull(tokens.last().tokens?.accessToken)
        assertNull(tokens.last().tokens?.idToken)
        assertNull(tokens.last().tokens?.expirationTime)

        val negative = ProviderRequestRegistry.registerTokens { tokens.add(it) }
        assertTrue(ProviderRequestRegistry.refreshSuccess(null, "access", -1L, negative))
        assertEquals(-1.0, tokens.last().tokens!!.expirationTime!!, 0.0)
    }

    @Test
    fun cancelAllSettlesEveryPendingRequestOnceAndLateCallbacksAreIgnored() {
        val login = registerUser("login")
        val scopes = registerUser("scopes")
        val silent = registerUser("silent")
        val refresh = ProviderRequestRegistry.registerTokens { tokens.add(it) }
        val revoke = ProviderRequestRegistry.registerRevocation { revocations.add(it) }

        ProviderRequestRegistry.cancelAll()
        ProviderRequestRegistry.cancelAll()

        val cancelled = ProviderFailure(AuthErrorCode.CANCELLED, null)
        assertEquals(List(3) { ProviderUserResult(null, cancelled) }, users)
        assertEquals(listOf(ProviderTokenResult(null, cancelled)), tokens)
        assertEquals(listOf(ProviderVoidResult(cancelled)), revocations)

        assertFalse(success(login))
        assertFalse(ProviderRequestRegistry.loginError("scopes", AuthErrorCode.NETWORK_ERROR.value, null, scopes))
        assertFalse(success(silent, origin = "silent"))
        assertFalse(ProviderRequestRegistry.refreshSuccess("id", "access", null, refresh))
        assertFalse(ProviderRequestRegistry.revokeResult(null, null, revoke))
        assertEquals(3, users.size)
        assertEquals(1, tokens.size)
        assertEquals(1, revocations.size)

        val next = registerUser()
        assertTrue(next > revoke)
        assertTrue(success(next))
    }

    @Test
    fun aSinkMayReenterTheRegistryWithoutDeadlock() {
        var nested = 0L
        val outer = ProviderRequestRegistry.registerUser("login") { result ->
            users.add(result)
            nested = registerUser("scopes")
            ProviderRequestRegistry.cancelAll()
        }
        assertTrue(ProviderRequestRegistry.loginError("login", AuthErrorCode.TIMEOUT.value, null, outer))
        assertEquals(listOf(AuthErrorCode.TIMEOUT, AuthErrorCode.CANCELLED), users.map { it.failure?.code })
        assertFalse(ProviderRequestRegistry.loginError("scopes", AuthErrorCode.UNKNOWN.value, null, nested))
    }

    @Test
    fun racingCallbacksAndCancellationSettleEachRequestExactlyOnce() {
        val requests = 400
        val counts = List(requests) { AtomicInteger(0) }
        val ids = counts.map { count -> ProviderRequestRegistry.registerUser("login") { count.incrementAndGet() } }
        val accepted = AtomicInteger(0)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val work = (0 until 8).map { worker ->
                pool.submit {
                    start.await()
                    for ((index, id) in ids.withIndex()) {
                        val settled = when ((index + worker) % 3) {
                            0 -> ProviderRequestRegistry.loginError("login", AuthErrorCode.NETWORK_ERROR.value, null, id)
                            1 -> ProviderRequestRegistry.loginSuccess(
                                "login", "google", null, null, null, null, null, null, null, null, null, null, null,
                                null, null, id,
                            )
                            else -> {
                                if (index % 50 == 0) ProviderRequestRegistry.cancelAll()
                                false
                            }
                        }
                        if (settled) accepted.incrementAndGet()
                    }
                }
            }
            start.countDown()
            work.forEach { it.get(30, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
        ProviderRequestRegistry.cancelAll()

        assertEquals(List(requests) { 1 }, counts.map { it.get() })
        assertTrue(accepted.get() <= requests)
    }
}

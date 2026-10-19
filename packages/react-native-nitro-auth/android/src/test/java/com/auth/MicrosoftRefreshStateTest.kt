package com.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MicrosoftRefreshStateTest {

    @Test
    fun refreshTokenClearsOnlyOnTerminalClientErrors() {
        assertTrue(MicrosoftAuthConfig.shouldClearRefreshToken(400))
        assertTrue(MicrosoftAuthConfig.shouldClearRefreshToken(401))
        assertFalse(MicrosoftAuthConfig.shouldClearRefreshToken(408))
        assertFalse(MicrosoftAuthConfig.shouldClearRefreshToken(429))
        assertFalse(MicrosoftAuthConfig.shouldClearRefreshToken(500))
        assertFalse(MicrosoftAuthConfig.shouldClearRefreshToken(200))
    }

    @Test
    fun staleRefreshCompletionCannotConsumeOrMutateReplacementOperation() {
        val authClass = AuthAdapter::class.java

        fun setField(name: String, value: Any?) {
            authClass.getDeclaredField(name).apply {
                isAccessible = true
                set(AuthAdapter, value)
            }
        }

        fun getField(name: String): Any? = authClass.getDeclaredField(name).let {
            it.isAccessible = true
            it.get(AuthAdapter)
        }

        val pendingRefresh = getField("pendingMicrosoftRefresh") as PendingOperation

        try {
            setField("googleAuthStateEpoch", 4L)
            pendingRefresh.begin(11L, 4L)
            setField("inMemoryMicrosoftRefreshToken", "token-a")

            val completionA = AuthAdapter.completeMicrosoftRefreshResponse(
                MicrosoftRefreshOperation.REFRESH,
                11L,
                200,
                "{\"id_token\":\"id-a\",\"access_token\":\"access-a\",\"refresh_token\":\"token-a-new\"}",
                listOf("openid"),
            )
            assertNotNull(completionA)

            setField("googleAuthStateEpoch", 5L)
            pendingRefresh.begin(12L, 5L)
            setField("inMemoryMicrosoftRefreshToken", "token-b")

            assertFalse(AuthAdapter.commitMicrosoftRefresh(completionA!!))
            assertEquals("token-b", getField("inMemoryMicrosoftRefreshToken"))
            assertEquals(12L, pendingRefresh.generation)

            val completionB = AuthAdapter.completeMicrosoftRefreshResponse(
                MicrosoftRefreshOperation.REFRESH,
                12L,
                200,
                "{\"id_token\":\"id-b\",\"access_token\":\"access-b\",\"refresh_token\":\"token-b-new\"}",
                listOf("openid", "profile"),
            )
            assertTrue(AuthAdapter.commitMicrosoftRefresh(completionB!!))
            assertEquals("token-b-new", getField("inMemoryMicrosoftRefreshToken"))
            assertNull(pendingRefresh.generation)
        } finally {
            pendingRefresh.clear()
            setField("inMemoryMicrosoftRefreshToken", null)
            setField("inMemoryMicrosoftScopes", listOf("openid", "email", "profile", "offline_access", "User.Read"))
            setField("googleAuthStateEpoch", 1L)
        }
    }

    @Test
    fun exchangeAndRefreshMapEmptyAccessTokensTheSameWay() {
        val authClass = AuthAdapter::class.java

        fun setField(name: String, value: Any?) {
            authClass.getDeclaredField(name).apply {
                isAccessible = true
                set(AuthAdapter, value)
            }
        }

        val pendingRefresh = authClass.getDeclaredField("pendingMicrosoftRefresh").let {
            it.isAccessible = true
            it.get(AuthAdapter) as PendingOperation
        }
        val payload = android.util.Base64.encodeToString(
            "{\"nonce\":\"nonce-a\"}".toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
        )
        val body = "{\"id_token\":\"e30.$payload.signature\",\"access_token\":\"\",\"refresh_token\":\"\"}"

        try {
            setField("googleAuthStateEpoch", 4L)
            pendingRefresh.begin(21L, 4L)
            val refreshed = AuthAdapter.completeMicrosoftRefreshResponse(
                MicrosoftRefreshOperation.REFRESH,
                21L,
                200,
                body,
                listOf("openid"),
            )
            setField("pendingMicrosoft", PendingMicrosoftAuth(Origin.LOGIN, 22L, listOf("openid")).also { it.nonce = "nonce-a" })
            val exchanged = AuthAdapter.completeMicrosoftTokenResponse(200, body, 22L, listOf("openid"))

            assertNotNull(refreshed)
            assertNotNull(exchanged)
            assertNull(refreshed!!.accessToken)
            assertEquals(refreshed.accessToken, exchanged!!.accessToken)
            assertEquals(refreshed.refreshToken, exchanged.refreshToken)
        } finally {
            pendingRefresh.clear()
            setField("pendingMicrosoft", null)
            setField("googleAuthStateEpoch", 1L)
        }
    }

    @Test
    fun refreshUsesTheTenantOfTheLogin() {
        val authClass = AuthAdapter::class.java

        fun setField(name: String, value: Any?) {
            authClass.getDeclaredField(name).apply {
                isAccessible = true
                set(AuthAdapter, value)
            }
        }

        val context = org.robolectric.RuntimeEnvironment.getApplication()
        try {
            assertEquals("common", AuthAdapter.microsoftSessionTenant(context))

            setField("pendingMicrosoft", PendingMicrosoftAuth(Origin.LOGIN, 31L, listOf("openid")))
            val completion = MicrosoftTokenCompletion(
                origin = Origin.LOGIN,
                generation = 31L,
                success = true,
                refreshToken = "refresh",
                scopes = listOf("openid"),
                tenant = "contoso.onmicrosoft.com",
            )
            assertTrue(AuthAdapter.commitMicrosoftTokenSuccess(completion))
            assertEquals("contoso.onmicrosoft.com", AuthAdapter.microsoftSessionTenant(context))

            setField("inMemoryMicrosoftTenant", null)
            assertEquals("common", AuthAdapter.microsoftSessionTenant(context))
        } finally {
            setField("pendingMicrosoft", null)
            setField("inMemoryMicrosoftRefreshToken", null)
            setField("inMemoryMicrosoftScopes", listOf("openid", "email", "profile", "offline_access", "User.Read"))
        }
    }
}

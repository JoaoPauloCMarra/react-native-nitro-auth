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
    fun staleRefreshCompletionCannotConsumeOrMutateReplacementOperation() {
        val authClass = AuthAdapter::class.java
        val operationClass = Class.forName("com.auth.MicrosoftRefreshOperation")
        val refreshOperation = operationClass.enumConstants
            ?.first { (it as Enum<*>).name == "REFRESH" }
            ?: error("REFRESH operation is unavailable")
        val complete = authClass.getDeclaredMethod(
            "completeMicrosoftRefreshResponse",
            operationClass,
            Long::class.javaPrimitiveType,
            Int::class.javaObjectType,
            String::class.java,
            List::class.java,
            String::class.java,
            Boolean::class.javaPrimitiveType,
        ).apply { isAccessible = true }
        val commit = authClass.getDeclaredMethod(
            "commitMicrosoftRefresh",
            Class.forName("com.auth.MicrosoftRefreshCompletion"),
        ).apply { isAccessible = true }

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

        try {
            setField("googleAuthStateEpoch", 4L)
            setField("pendingMicrosoftRefreshGeneration", 11L)
            setField("pendingMicrosoftRefreshStateEpoch", 4L)
            setField("inMemoryMicrosoftRefreshToken", "token-a")

            val completionA = complete.invoke(
                AuthAdapter,
                refreshOperation,
                11L,
                200,
                "{\"id_token\":\"id-a\",\"access_token\":\"access-a\",\"refresh_token\":\"token-a-new\"}",
                listOf("openid"),
                null,
                false,
            )
            assertNotNull(completionA)

            setField("googleAuthStateEpoch", 5L)
            setField("pendingMicrosoftRefreshGeneration", 12L)
            setField("pendingMicrosoftRefreshStateEpoch", 5L)
            setField("inMemoryMicrosoftRefreshToken", "token-b")

            assertFalse(commit.invoke(AuthAdapter, completionA) as Boolean)
            assertEquals("token-b", getField("inMemoryMicrosoftRefreshToken"))
            assertEquals(12L, getField("pendingMicrosoftRefreshGeneration"))

            val completionB = complete.invoke(
                AuthAdapter,
                refreshOperation,
                12L,
                200,
                "{\"id_token\":\"id-b\",\"access_token\":\"access-b\",\"refresh_token\":\"token-b-new\"}",
                listOf("openid", "profile"),
                null,
                false,
            )
            assertTrue(commit.invoke(AuthAdapter, completionB) as Boolean)
            assertEquals("token-b-new", getField("inMemoryMicrosoftRefreshToken"))
            assertNull(getField("pendingMicrosoftRefreshGeneration"))
        } finally {
            setField("pendingMicrosoftRefreshGeneration", null)
            setField("pendingMicrosoftRefreshStateEpoch", null)
            setField("inMemoryMicrosoftRefreshToken", null)
            setField("inMemoryMicrosoftScopes", listOf("openid", "email", "profile", "offline_access", "User.Read"))
            setField("googleAuthStateEpoch", 1L)
        }
    }
}

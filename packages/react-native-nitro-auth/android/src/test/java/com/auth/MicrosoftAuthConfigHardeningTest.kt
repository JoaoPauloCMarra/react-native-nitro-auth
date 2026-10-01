package com.auth

import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MicrosoftAuthConfigHardeningTest {

    @Test
    fun generatedOAuthTableMatchesTheSharedJsonSource() {
        val source = JSONObject(findOAuthErrorSource().readText(Charsets.UTF_8))
        val expected = source.keys().asSequence().associateWith { source.getString(it) }

        assertTrue(expected.isNotEmpty())
        assertEquals(expected, OAUTH_ERROR_CODES.mapValues { it.value.wire })
    }

    @Test
    fun everyTableEntryMapsToItsCodeInEveryContext() {
        for ((providerError, code) in OAUTH_ERROR_CODES) {
            assertEquals(code, MicrosoftAuthConfig.mapMicrosoftOAuthError(providerError))
            assertEquals(code, MicrosoftAuthConfig.mapMicrosoftOAuthError(providerError, "token"))
            assertEquals(code, MicrosoftAuthConfig.mapMicrosoftOAuthError("  ${providerError.uppercase()}\n"))
            val refreshCode = if (code == AuthErrorCode.TOKEN_ERROR) AuthErrorCode.REFRESH_FAILED else code
            assertEquals(refreshCode, MicrosoftAuthConfig.mapMicrosoftOAuthError(providerError, "refresh"))
        }
    }

    @Test
    fun unknownEmptyAndHostileProviderErrorsMapToUnknown() {
        val hostile = listOf(
            "",
            " ",
            "not_a_real_error",
            "invalid_grant extra",
            "invalid_grant\u0000",
            "x".repeat(1_000_000),
            "🚀",
        )
        for (value in hostile) {
            assertEquals(AuthErrorCode.UNKNOWN, MicrosoftAuthConfig.mapMicrosoftOAuthError(value))
            assertEquals(AuthErrorCode.UNKNOWN, MicrosoftAuthConfig.mapMicrosoftOAuthError(value, "refresh"))
        }
    }

    @Test
    fun refreshTokenIsClearedOnlyForTerminalClientErrors() {
        for (code in listOf(400, 401, 403, 404, 499)) {
            assertTrue(MicrosoftAuthConfig.shouldClearRefreshToken(code))
        }
        for (code in listOf(Int.MIN_VALUE, -1, 0, 200, 302, 399, 408, 429, 500, 503, Int.MAX_VALUE)) {
            assertFalse(MicrosoftAuthConfig.shouldClearRefreshToken(code))
        }
    }

    @Test
    fun malformedJwtsDecodeToAnEmptyClaimMap() {
        val malformed = listOf(
            "",
            ".",
            "..",
            "header-only",
            "header.",
            "header..signature",
            "header.!!!!.signature",
            "header.e30 .signature",
            "header.${encode("not json")}.signature",
            "header.${encode("[1,2,3]")}.signature",
            "header.${encode("null")}.signature",
            "header.${encode("{\"unterminated\":")}.signature",
            "header.${encode("{}")}.signature",
        )
        for (token in malformed) {
            assertTrue(token, MicrosoftAuthConfig.decodeJwt(token).isEmpty())
        }
    }

    @Test
    fun wellFormedClaimsSurviveHugeAndNumericPayloads() {
        val largeName = "n".repeat(512 * 1024)
        val claims = MicrosoftAuthConfig.decodeJwt(
            "header.${encode("{\"name\":\"$largeName\",\"exp\":1789500000,\"nonce\":\"\"}")}.signature",
        )

        assertEquals(largeName, claims["name"])
        assertEquals("1789500000", claims["exp"])
        assertFalse(claims.containsKey("nonce"))
        assertEquals(
            "4102444800",
            MicrosoftAuthConfig.decodeJwt("header.${encode("{\"exp\":4102444800}")}.signature")["exp"],
        )
    }

    @Test
    fun nullAndStructuredClaimsAreDroppedInsteadOfStringified() {
        val claims = MicrosoftAuthConfig.decodeJwt(
            "header.${encode("{\"email\":null,\"groups\":[\"a\"],\"address\":{\"x\":1},\"verified\":true,\"blocked\":false,\"exp\":5,\"ratio\":1.5,\"name\":\"Ada\"}")}.signature",
        )

        assertEquals(
            mapOf("verified" to "true", "blocked" to "false", "exp" to "5", "ratio" to "1.5", "name" to "Ada"),
            claims,
        )
    }

    @Test
    fun authorityUrlRejectsHostileTenantsAndDomains() {
        assertEquals(
            "https://login.microsoftonline.com/common/",
            MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(" common ", null),
        )
        assertEquals(
            "https://login.microsoftonline.com/common/",
            MicrosoftAuthConfig.getMicrosoftAuthBaseUrl("common", "  "),
        )
        assertEquals(
            "https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_signin/",
            MicrosoftAuthConfig.getMicrosoftAuthBaseUrl("B2C_1_signin", " Contoso.B2CLogin.com "),
        )
        assertEquals(
            "https://login.example.com/tenant.onmicrosoft.com/B2C_1_signin/",
            MicrosoftAuthConfig.getMicrosoftAuthBaseUrl("tenant.onmicrosoft.com/B2C_1_signin", "login.example.com"),
        )

        for (tenant in listOf("", " ", "../evil", "a/b", "evil.com/path?x=1", "tenant#fragment", "user@evil", "t".repeat(129), "tenant\nname")) {
            assertNull(tenant, MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(tenant, null))
        }
        for (domain in listOf("evil.com/path", "user@evil.com", "evil.com#fragment", "127.0.0.1", "localhost", "evil.com:8443", "-evil.com", "evil..com")) {
            assertNull(domain, MicrosoftAuthConfig.getMicrosoftAuthBaseUrl("tenant.onmicrosoft.com/B2C_1_signin", domain))
        }
        assertNull(MicrosoftAuthConfig.getMicrosoftAuthBaseUrl("B2C_1_signin", "login.example.com"))
        assertNull(MicrosoftAuthConfig.getMicrosoftAuthBaseUrl("a/b/c", "contoso.b2clogin.com"))
    }

    @Test
    fun nonceIsUrlSafeRandomAndHashedWithSha256() {
        val first = AuthAdapter.createNonce()
        val second = AuthAdapter.createNonce()

        for (nonce in listOf(first, second)) {
            assertEquals(2, nonce.size)
            assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(nonce[0]))
            assertEquals(32, Base64.decode(nonce[0], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP).size)
            assertTrue(Regex("^[a-f0-9]{64}$").matches(nonce[1]))
            assertEquals(sha256Hex(nonce[0]), nonce[1])
        }
        assertNotEquals(first[0], second[0])
    }

    private fun encode(payload: String): String = Base64.encodeToString(
        payload.toByteArray(Charsets.UTF_8),
        Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
    )

    private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.US_ASCII))
        .joinToString("") { byte -> (byte.toInt() and 0xff).toString(16).padStart(2, '0') }

    private fun findOAuthErrorSource(): File {
        var directory: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (directory != null) {
            val candidates = listOf(
                File(directory, "scripts/oauth-errors.json"),
                File(directory, "packages/react-native-nitro-auth/scripts/oauth-errors.json"),
            )
            candidates.firstOrNull(File::isFile)?.let { return it }
            directory = directory.parentFile
        }
        throw AssertionError("scripts/oauth-errors.json was not found above ${System.getProperty("user.dir")}")
    }
}

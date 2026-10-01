package com.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.SecureRandom
import java.util.LinkedHashMap

class AuthFlowHardeningTest {
    private val scheme = "nitro-auth-example"
    private val attempt = "047168d4-5b95-4ea2-9b46-193bc1ea0fc8"
    private val booleans = listOf(false, true)

    private class FixedRandom(private val value: Byte) : SecureRandom() {
        override fun nextBytes(bytes: ByteArray) {
            bytes.fill(value)
        }
    }

    private class FailingRandom : SecureRandom() {
        override fun nextBytes(bytes: ByteArray) {
            throw IllegalStateException("entropy unavailable")
        }
    }

    @Test
    fun malformedAppleCallbackUrisAreNeverAcceptedAsCurrent() {
        val malformed = listOf(
            null,
            "",
            " ",
            "not a uri",
            "$scheme://apple/callback",
            "$scheme://apple/callback?",
            "$scheme://apple/callback?attemptId",
            "$scheme://apple/callback?attemptId=",
            "$scheme://apple/callback?attemptId=${attempt.uppercase()}",
            "$scheme://apple/callback?attemptId=$attempt%zz",
            "$scheme://apple/callback?attemptId=%",
            "$scheme://apple/callback?attemptId=$attempt&attemptId=$attempt",
            "$scheme://apple/callback?other=$attempt",
            "$scheme://apple/callback?attemptId=$attempt#fragment",
            "$scheme://user@apple/callback?attemptId=$attempt",
            "$scheme://apple:443/callback?attemptId=$attempt",
            "$scheme://apple/callback/?attemptId=$attempt",
            "$scheme://apple/callback/../callback?attemptId=$attempt",
            "$scheme://apple/Callback?attemptId=$attempt",
            "$scheme:apple/callback?attemptId=$attempt",
            "$scheme:///callback?attemptId=$attempt",
            "https://apple/callback?attemptId=$attempt",
            "$scheme://apple/callback?attemptId=$attempt\u0000",
            "$scheme://apple/callback?attemptId=" + "a".repeat(1_000_000),
        )
        for (callback in malformed) {
            assertEquals(
                callback?.take(120),
                AppleCallbackDecision.INVALID,
                classifyAppleCallback(callback, scheme, attempt, alreadyHandled = false),
            )
            assertEquals(
                callback?.take(120),
                AppleCallbackDecision.INVALID,
                classifyAppleCallback(callback, scheme, attempt, alreadyHandled = true),
            )
        }
    }

    @Test
    fun appleCallbackWithoutACanonicalActiveAttemptIsNoActiveFlow() {
        val callback = "$scheme://apple/callback?attemptId=$attempt"
        for (current in listOf(null, "", " ", "not-a-uuid", attempt.uppercase(), "$attempt ", "1-1-1-1-1")) {
            for (alreadyHandled in booleans) {
                assertEquals(
                    AppleCallbackDecision.NO_ACTIVE_FLOW,
                    classifyAppleCallback(callback, scheme, current, alreadyHandled),
                )
                assertEquals(
                    AppleCallbackDecision.NO_ACTIVE_FLOW,
                    classifyAppleCallback(null, scheme, current, alreadyHandled),
                )
            }
        }
    }

    @Test
    fun appleCallbackIsClaimedOnceAndDuplicatesStayDuplicates() {
        val callback = "$scheme://apple/callback?attemptId=$attempt"

        assertEquals(AppleCallbackDecision.CURRENT, classifyAppleCallback(callback, scheme, attempt, false))
        repeat(3) {
            assertEquals(AppleCallbackDecision.DUPLICATE, classifyAppleCallback(callback, scheme, attempt, true))
        }
    }

    @Test
    fun applePkceVerifierUsesTheInjectedRandomSourceAndKeepsLeadingZeros() {
        assertEquals("00".repeat(32), createAppleCodeVerifier(FixedRandom(0)))
        assertEquals("ff".repeat(32), createAppleCodeVerifier(FixedRandom(-1)))
        assertEquals("0a".repeat(32), createAppleCodeVerifier(FixedRandom(10)))

        val pair = createAppleCodePair(FixedRandom(0x61))
        assertEquals("61".repeat(32), pair.verifier)
        assertEquals(createAppleCodeChallenge(pair.verifier), pair.challenge)
        assertEquals(
            "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
            createAppleCodeChallenge("a".repeat(64)),
        )
        assertNotEquals(createAppleCodeVerifier(), createAppleCodeVerifier())
    }

    @Test
    fun secureRandomFailureIsNotSwallowedIntoAPredictableVerifier() {
        for (block in listOf<() -> Unit>(
            { createAppleCodeVerifier(FailingRandom()) },
            { createAppleCodePair(FailingRandom()) },
        )) {
            try {
                block()
                fail("A failed entropy source must not produce a verifier")
            } catch (error: IllegalStateException) {
                assertEquals("entropy unavailable", error.message)
            }
        }
    }

    @Test
    fun applePkceChallengeRejectsEveryNonCanonicalVerifier() {
        val invalid = listOf(
            "",
            "a".repeat(63),
            "a".repeat(65),
            "A".repeat(64),
            "g".repeat(64),
            "a".repeat(63) + "\n",
            "a".repeat(64) + "\n",
            " " + "a".repeat(63),
            "a".repeat(1_000_000),
        )
        for (verifier in invalid) {
            try {
                createAppleCodeChallenge(verifier)
                fail("Verifier of length ${verifier.length} must be rejected")
            } catch (_: IllegalArgumentException) {
            }
        }
    }

    @Test
    fun appleScopesAreValidatedBeforeAnyRequest() {
        assertEquals(emptyList<String>(), validateAppleScopes(emptyList()))
        assertEquals(listOf("email", "fullName"), validateAppleScopes(listOf("email", "fullName", "email")))
        for (scopes in listOf(listOf("openid"), listOf("email", ""), listOf("Email"), listOf("fullname"), listOf("email profile"))) {
            try {
                validateAppleScopes(scopes)
                fail("Scopes $scopes must be rejected")
            } catch (error: AppleAndroidBrokerException) {
                assertEquals(AuthErrorCode.CONFIGURATION_ERROR, error.authErrorCode)
            }
        }
    }

    @Test
    fun appleBrokerConfigurationRejectsMalformedAndBlankInputs() {
        val rejected = listOf<Pair<String?, String?>>(
            null to scheme,
            "" to scheme,
            "   " to scheme,
            "https://auth.example.test" to null,
            "https://auth.example.test" to "",
            "https://auth.example.test" to " ",
            "https://auth.example.test" to "a".repeat(65),
            "https://auth.example.test" to "1scheme",
            "https://auth.example.test" to "intent",
            "https://auth.example.test" to "content",
            "https://auth.example.test" to "file",
            "https://auth.example.test#fragment" to scheme,
            "https://" to scheme,
            "https:///path" to scheme,
            "not a url" to scheme,
            "ftp://auth.example.test" to scheme,
            "//auth.example.test" to scheme,
            "https://auth.example.test/a\\b" to scheme,
        )
        for ((baseUrl, callbackScheme) in rejected) {
            assertNull("$baseUrl / $callbackScheme", AppleAndroidBrokerConfig.parse(baseUrl, callbackScheme))
        }

        val config = AppleAndroidBrokerConfig.parse("  HTTPS://Auth.Example.Test:8443/mobile///  ", "  $scheme  ")
        assertEquals("https://auth.example.test:8443/mobile", config?.baseUrl)
        assertEquals(scheme, config?.callbackScheme)
    }

    @Test
    fun microsoftRedirectWithMalformedStateIsNeverCurrent() {
        val known = mapOf("state-a" to 1L, "state-b" to 2L)
        for (callbackState in listOf(null, "", " ", "state-b ", "STATE-B", "state-b\u0000", "unknown", "s".repeat(1_000_000))) {
            assertEquals(
                MicrosoftRedirectDecision.INVALID,
                classifyMicrosoftRedirect("state-b", 2L, callbackState, redirectReceived = false, knownStates = known),
            )
            assertEquals(
                MicrosoftRedirectDecision.DUPLICATE,
                classifyMicrosoftRedirect("state-b", 2L, callbackState, redirectReceived = true, knownStates = known),
            )
        }
    }

    @Test
    fun microsoftRedirectAfterTheFlowEndedIsNoActiveFlow() {
        val known = mapOf("state-a" to 1L)
        val inactive = listOf<Pair<String?, Long?>>(
            null to null,
            null to 1L,
            "" to 1L,
            "state-a" to null,
            "state-a" to 0L,
            "state-a" to -1L,
            "state-a" to Long.MIN_VALUE,
        )
        for ((currentState, currentGeneration) in inactive) {
            for (redirectReceived in booleans) {
                for (callbackState in listOf(null, "", "state-a", "other")) {
                    assertEquals(
                        MicrosoftRedirectDecision.NO_ACTIVE_FLOW,
                        classifyMicrosoftRedirect(currentState, currentGeneration, callbackState, redirectReceived, known),
                    )
                }
            }
        }
    }

    @Test
    fun microsoftRedirectFromAnOlderGenerationIsStaleEvenAfterTheCurrentOneArrived() {
        val known = mapOf("state-a" to 1L, "state-b" to Long.MAX_VALUE)
        for (redirectReceived in booleans) {
            assertEquals(
                MicrosoftRedirectDecision.STALE,
                classifyMicrosoftRedirect("state-b", Long.MAX_VALUE, "state-a", redirectReceived, known),
            )
        }
        assertEquals(
            MicrosoftRedirectDecision.CURRENT,
            classifyMicrosoftRedirect("state-b", Long.MAX_VALUE, "state-b", redirectReceived = false, knownStates = known),
        )
        assertNull(microsoftResumeSuppressionFor(MicrosoftRedirectDecision.STALE, null))
        assertNull(microsoftResumeSuppressionFor(MicrosoftRedirectDecision.STALE, 0L))
        assertNull(microsoftResumeSuppressionFor(MicrosoftRedirectDecision.STALE, -5L))
        assertEquals(7L, microsoftResumeSuppressionFor(MicrosoftRedirectDecision.STALE, 7L))
        for (decision in MicrosoftRedirectDecision.entries.filter { it != MicrosoftRedirectDecision.STALE }) {
            assertNull(microsoftResumeSuppressionFor(decision, 7L))
        }
    }

    @Test
    fun knownMicrosoftStatesStayBoundedUnderLongSessions() {
        val states = LinkedHashMap<String, Long>()
        rememberMicrosoftState(states, "", 1L)
        rememberMicrosoftState(states, "state", 0L)
        rememberMicrosoftState(states, "state", -1L)
        rememberMicrosoftState(states, "state", 1L, maxStates = 0)
        rememberMicrosoftState(states, "state", 1L, maxStates = -1)
        assertTrue(states.isEmpty())

        for (generation in 1L..10_000L) {
            rememberMicrosoftState(states, "state-$generation", generation)
            assertTrue(states.size <= MAX_KNOWN_MICROSOFT_STATES)
        }
        assertEquals(MAX_KNOWN_MICROSOFT_STATES, states.size)
        assertEquals(10_000L, states["state-10000"])
        assertEquals(9_969L, states["state-9969"])
        assertFalse(states.containsKey("state-9968"))

        repeat(100) { rememberMicrosoftState(states, "state-10000", 10_000L) }
        assertEquals(MAX_KNOWN_MICROSOFT_STATES, states.size)

        val single = LinkedHashMap<String, Long>()
        rememberMicrosoftState(single, "first", 1L, maxStates = 1)
        rememberMicrosoftState(single, "second", 2L, maxStates = 1)
        assertEquals(mapOf("second" to 2L), single)
    }

    @Test
    fun browserResumeNeverCancelsAnInactiveOrAlreadyAnsweredFlow() {
        for (inProgress in booleans) for (opened in booleans) for (received in booleans) for (isHandler in booleans) {
            for (suppression in listOf(null, 1L, 2L)) for (generation in listOf(null, 1L, 2L)) {
                val expected = inProgress && opened && !received && !isHandler &&
                    !(suppression != null && suppression == generation)
                assertEquals(
                    expected,
                    shouldCancelMicrosoftAuth(inProgress, opened, received, isHandler, suppression, generation),
                )
                assertEquals(
                    expected,
                    shouldCancelAppleAuth(inProgress, opened, received, isHandler, suppression, generation),
                )
                if (!inProgress || !opened || received || isHandler) {
                    assertFalse(shouldCancelMicrosoftAuth(inProgress, opened, received, isHandler, suppression, generation))
                    assertFalse(shouldCancelAppleAuth(inProgress, opened, received, isHandler, suppression, generation))
                }
                val consumes = !isHandler && suppression != null && suppression == generation
                assertEquals(consumes, shouldConsumeMicrosoftResumeSuppression(suppression, generation, isHandler))
                assertEquals(consumes, shouldConsumeAppleResumeSuppression(suppression, generation, isHandler))
            }
        }
    }

    @Test
    fun callbacksFromDeadOrReplacedGenerationsAreRejected() {
        assertTrue(acceptsAuthCallback(1L, 1L))
        assertTrue(acceptsAuthCallback(Long.MAX_VALUE, Long.MAX_VALUE))
        for ((active, callback) in listOf<Pair<Long?, Long>>(
            null to 0L,
            null to 1L,
            0L to 0L,
            -1L to -1L,
            Long.MIN_VALUE to Long.MIN_VALUE,
            2L to 1L,
            1L to 2L,
            1L to 0L,
            1L to -1L,
        )) {
            assertFalse("$active/$callback", acceptsAuthCallback(active, callback))
            assertFalse("$active/$callback", acceptsAuthStateCallback(active, callback, 1L, 1L, 1L))
        }

        assertTrue(acceptsAuthStateCallback(3L, 3L, 5L, 5L, 5L))
        assertFalse(acceptsAuthStateCallback(3L, 3L, null, 5L, 5L))
        assertFalse(acceptsAuthStateCallback(3L, 3L, 5L, null, 5L))
        assertFalse(acceptsAuthStateCallback(3L, 3L, null, null, 5L))
        assertFalse(acceptsAuthStateCallback(3L, 3L, 5L, 4L, 5L))
        assertFalse(acceptsAuthStateCallback(3L, 3L, 5L, 5L, 6L))
        assertFalse(acceptsAuthStateCallback(3L, 3L, 4L, 4L, 5L))
    }

    @Test
    fun googlePickerActivityNeverLaunchesTwiceOrAfterDeath() {
        for (saved in booleans) for (delivered in booleans) for (started in booleans) {
            val activityDecision = decideGoogleSignInActivity(saved, delivered, started)
            val expectedActivityDecision = when {
                delivered -> GoogleSignInActivityDecision.FINISH
                saved && started -> GoogleSignInActivityDecision.WAIT_FOR_RESULT
                else -> GoogleSignInActivityDecision.START
            }
            assertEquals(expectedActivityDecision, activityDecision)

            for (finishing in booleans) for (destroyed in booleans) for (tokenIsCurrent in booleans) {
                val decision = decideGoogleSignInLaunch(
                    lifecycleStateSaved = saved,
                    resultDelivered = delivered,
                    launchStarted = started,
                    callbackLaunchToken = if (tokenIsCurrent) 9L else 8L,
                    currentLaunchToken = 9L,
                    activityFinishing = finishing,
                    activityDestroyed = destroyed,
                )
                val expected = when {
                    delivered || started || finishing || destroyed -> GoogleSignInLaunchDecision.IGNORE
                    saved -> GoogleSignInLaunchDecision.DEFER
                    !tokenIsCurrent -> GoogleSignInLaunchDecision.IGNORE
                    else -> GoogleSignInLaunchDecision.LAUNCH
                }
                assertEquals(expected, decision)
            }

            for (finishing in booleans) {
                assertEquals(
                    finishing && !delivered,
                    shouldSettleGoogleSignInCancellation(delivered, finishing),
                )
            }
        }
    }

    @Test
    fun googleSessionRestoredFromCorruptPersistenceFallsBackToNoSession() {
        for (kind in listOf(null, "", " ", "LEGACY", "Modern", "none", "legacy ", "\u0000", "x".repeat(100_000))) {
            val restored = restoreGoogleSessionState(kind, "account", "company.example")
            assertEquals(GoogleSessionKind.NONE, restored.kind)
            assertEquals("none", restored.persistedKind())
        }
        for (kind in listOf("legacy", "modern")) {
            val restored = restoreGoogleSessionState(kind, null, null)
            assertEquals(kind, restored.persistedKind())
            assertNull(restored.accountId)
            assertNull(restored.returnedHostedDomain())
            assertNull(restored.returnedHostedDomainForAccount(null))
            assertNull(restored.returnedHostedDomainForAccount("account"))
        }

        val restored = restoreGoogleSessionState("modern", "account-a", "company.example")
        assertEquals("company.example", restored.returnedHostedDomainForAccount("account-a"))
        assertNull(restored.returnedHostedDomainForAccount("account-b"))
        assertNull(restored.returnedHostedDomainForAccount(""))

        for (kind in GoogleSessionKind.entries) for (tracked in booleans) for (sdkHasAccount in booleans) {
            assertEquals(
                kind != GoogleSessionKind.MODERN && (tracked || sdkHasAccount),
                isLegacyGoogleRevokeEligible(kind, tracked, sdkHasAccount),
            )
        }
    }
}

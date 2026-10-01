package com.auth

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import com.margelo.nitro.com.auth.AuthErrorCode as NitroErrorCode
import com.margelo.nitro.com.auth.AuthProvider
import com.margelo.nitro.com.auth.ProviderRequestRegistry
import com.margelo.nitro.com.auth.ProviderTokenResult
import com.margelo.nitro.com.auth.ProviderUserResult
import com.margelo.nitro.com.auth.ProviderVoidResult
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AuthAdapterFlowTest {
    private class ConfiguredApp(private val host: Application) : Application() {
        private val configuredResources by lazy { ConfiguredResources(host.resources) }

        init {
            attachBaseContext(host)
        }

        override fun getApplicationContext(): Context = this

        override fun getResources(): Resources = configuredResources

        override fun registerActivityLifecycleCallbacks(callback: ActivityLifecycleCallbacks) {
            host.registerActivityLifecycleCallbacks(callback)
        }

        override fun unregisterActivityLifecycleCallbacks(callback: ActivityLifecycleCallbacks) {
            host.unregisterActivityLifecycleCallbacks(callback)
        }
    }

    private class ConfiguredResources(base: Resources) :
        Resources(base.assets, base.displayMetrics, base.configuration) {
        override fun getIdentifier(name: String?, defType: String?, defPackage: String?): Int {
            val index = resourceNames.indexOf(name)
            return if (index >= 0 && defType == "string" && configuredStrings.containsKey(name)) {
                FIRST_RESOURCE_ID + index
            } else {
                super.getIdentifier(name, defType, defPackage)
            }
        }

        override fun getString(id: Int): String {
            val name = resourceNames.getOrNull(id - FIRST_RESOURCE_ID)
            return configuredStrings[name] ?: super.getString(id)
        }
    }

    private class ScriptedConnection(
        url: URL,
        private val status: Int,
        private val responseBody: String,
    ) : HttpURLConnection(url) {
        val requestBody = ByteArrayOutputStream()

        override fun connect() = Unit

        override fun disconnect() = Unit

        override fun usingProxy(): Boolean = false

        override fun getOutputStream(): ByteArrayOutputStream = requestBody

        override fun getResponseCode(): Int = status

        override fun getInputStream() = ByteArrayInputStream(responseBody.toByteArray(StandardCharsets.UTF_8))

        override fun getErrorStream() =
            if (status in 200..299) null else ByteArrayInputStream(responseBody.toByteArray(StandardCharsets.UTF_8))
    }

    private companion object {
        const val FIRST_RESOURCE_ID = 0x7f990000
        const val CLIENT_ID = "client-id-123"
        const val ATTEMPT_ID = "047168d4-5b95-4ea2-9b46-193bc1ea0fc8"
        const val APPLE_SCHEME = "nitro-auth-test"
        val resourceNames = listOf(
            "nitro_auth_microsoft_client_id",
            "nitro_auth_microsoft_tenant",
            "nitro_auth_microsoft_b2c_domain",
            "nitro_auth_google_client_id",
            "nitro_auth_apple_android_broker_url",
            "nitro_auth_apple_android_callback_scheme",
        )
        val configuredStrings = java.util.concurrent.ConcurrentHashMap<String, String>()
    }

    private lateinit var app: Application
    private lateinit var configuredApp: Application
    private val users = CopyOnWriteArrayList<ProviderUserResult>()
    private val tokens = CopyOnWriteArrayList<ProviderTokenResult>()
    private val revocations = CopyOnWriteArrayList<ProviderVoidResult>()
    private val releaseBroker = CountDownLatch(1)

    @Before
    fun setUp() {
        configuredStrings.clear()
        app = RuntimeEnvironment.getApplication()
        configuredApp = ConfiguredApp(app)
        AuthAdapter.dispose()
        AuthAdapter.initialize(configuredApp)
    }

    @After
    fun tearDown() {
        releaseBroker.countDown()
        AuthAdapter.appleBrokerFactory = { AppleAndroidBroker(it) }
        ProviderRequestRegistry.cancelAll()
        AuthAdapter.dispose()
        configuredStrings.clear()
    }

    private fun configureMicrosoft(tenant: String? = "organizations") {
        configuredStrings["nitro_auth_microsoft_client_id"] = CLIENT_ID
        if (tenant != null) configuredStrings["nitro_auth_microsoft_tenant"] = tenant
    }

    private fun configureApple() {
        configuredStrings["nitro_auth_apple_android_broker_url"] = "https://auth.example.test/mobile"
        configuredStrings["nitro_auth_apple_android_callback_scheme"] = APPLE_SCHEME
    }

    private fun registerUser(origin: String = "login"): Long =
        ProviderRequestRegistry.registerUser(origin) { users.add(it) }

    private fun login(provider: String, nonce: String? = null, scopes: Array<String>? = null): Long {
        val id = registerUser()
        AuthAdapter.loginSync(
            context = configuredApp,
            provider = provider,
            scopes = scopes,
            loginHint = null,
            nonce = nonce,
            useOneTap = false,
            generation = id,
        )
        return id
    }

    private fun failureOf(result: ProviderUserResult): Pair<NitroErrorCode?, String?> =
        result.failure?.code to result.failure?.detail

    private fun idleMain() = shadowOf(Looper.getMainLooper()).idle()

    private fun awaitUsers(count: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (users.size < count && System.nanoTime() < deadline) {
            idleMain()
            Thread.yield()
        }
        idleMain()
        assertEquals(count, users.size)
    }

    private fun resumedHost(): ActivityController<Activity> =
        Robolectric.buildActivity(Activity::class.java).setup()

    private fun startedMicrosoftUrl(source: Any = app): Uri {
        val intent = when (source) {
            is Activity -> shadowOf(source).nextStartedActivity
            else -> shadowOf(app).nextStartedActivity
        }
        assertNotNull(intent)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        return intent.data!!
    }

    private fun redirect(query: String): Uri = Uri.parse("msauth://${app.packageName}/$CLIENT_ID?$query")

    private fun brokerReturning(vararg responses: Pair<Int, String>): List<ScriptedConnection> {
        val connections = CopyOnWriteArrayList<ScriptedConnection>()
        val queue = java.util.concurrent.ConcurrentLinkedQueue(responses.toList())
        AuthAdapter.appleBrokerFactory = { config ->
            AppleAndroidBroker(config, connectionFactory = { url ->
                val (status, body) = queue.poll() ?: (500 to "{}")
                ScriptedConnection(url, status, body).also { connections.add(it) }
            })
        }
        return connections
    }

    private fun startResponse(): Pair<Int, String> = 200 to
        """{"data":{"attemptId":"$ATTEMPT_ID","authorizationUrl":"https://appleid.apple.com/auth/authorize?client_id=x"}}"""

    @Test
    fun unsupportedProviderAndMissingConfigurationSettleOnceWithoutOpeningAnything() {
        val unsupported = login("facebook")
        assertEquals(NitroErrorCode.UNSUPPORTED_PROVIDER to "Unsupported provider: facebook", failureOf(users.single()))
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, unsupported))

        for (provider in listOf("microsoft", "google", "apple")) {
            users.clear()
            val id = login(provider)
            idleMain()
            assertEquals(provider, NitroErrorCode.CONFIGURATION_ERROR, users.single().failure?.code)
            assertFalse(provider, ProviderRequestRegistry.loginError("login", 1, null, id))
        }
        assertNull(shadowOf(app).nextStartedActivity)
    }

    @Test
    fun invalidMicrosoftTenantAndInvalidAppleNonceAreRejectedBeforeAnyBrowserOrNetworkUse() {
        configureMicrosoft(tenant = "../evil")
        login("microsoft")
        assertEquals(
            NitroErrorCode.CONFIGURATION_ERROR to "Invalid Microsoft tenant or B2C domain",
            failureOf(users.single()),
        )
        assertNull(shadowOf(app).nextStartedActivity)

        users.clear()
        configureApple()
        var brokerCreated = false
        AuthAdapter.appleBrokerFactory = { config ->
            brokerCreated = true
            AppleAndroidBroker(config)
        }
        for (nonce in listOf("", "not-hex", "A".repeat(64), "a".repeat(63), "a".repeat(65))) {
            users.clear()
            login("apple", nonce = nonce)
            assertEquals(nonce, NitroErrorCode.INVALID_NONCE, users.single().failure?.code)
        }
        assertFalse(brokerCreated)
    }

    @Test
    fun microsoftLoginWithoutAForegroundActivityFallsBackToAPlainBrowserIntent() {
        configureMicrosoft()
        val id = login("microsoft", scopes = arrayOf("openid", "User.Read"))

        val intent = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        val url = intent.data!!
        assertEquals("https", url.scheme)
        assertEquals("login.microsoftonline.com", url.host)
        assertEquals("/organizations/oauth2/v2.0/authorize", url.path)
        assertEquals(CLIENT_ID, url.getQueryParameter("client_id"))
        assertEquals("msauth://${app.packageName}/$CLIENT_ID", url.getQueryParameter("redirect_uri"))
        assertEquals("code", url.getQueryParameter("response_type"))
        assertEquals("query", url.getQueryParameter("response_mode"))
        assertEquals("openid User.Read", url.getQueryParameter("scope"))
        assertEquals("S256", url.getQueryParameter("code_challenge_method"))
        assertEquals("select_account", url.getQueryParameter("prompt"))
        assertNull(url.getQueryParameter("login_hint"))
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(url.getQueryParameter("code_challenge")!!))
        assertFalse(url.getQueryParameter("state").isNullOrEmpty())
        assertFalse(url.getQueryParameter("nonce").isNullOrEmpty())
        assertNotEquals(url.getQueryParameter("state"), url.getQueryParameter("nonce"))
        assertTrue(users.isEmpty())

        ProviderRequestRegistry.cancelAll()
        assertEquals(NitroErrorCode.CANCELLED, users.single().failure?.code)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, id))
    }

    @Test
    fun microsoftLoginFromAResumedActivityUsesCustomTabs() {
        configureMicrosoft(tenant = null)
        val host = resumedHost()
        login("microsoft")

        val intent = shadowOf(host.get()).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertTrue(intent.hasExtra("android.support.customtabs.extra.SESSION"))
        assertEquals("/common/oauth2/v2.0/authorize", intent.data!!.path)
        assertNull(shadowOf(app).nextStartedActivity)
        assertTrue(users.isEmpty())
    }

    @Test
    fun missingBrowserFailsTheLoginOnceAndLeavesTheNextAttemptUsable() {
        configureMicrosoft()
        shadowOf(app).checkActivities(true)

        login("microsoft")
        assertEquals(NitroErrorCode.UNKNOWN, users.single().failure?.code)
        assertFalse(users.single().failure?.detail.isNullOrEmpty())

        users.clear()
        val host = resumedHost()
        login("microsoft")
        assertEquals(NitroErrorCode.UNKNOWN, users.single().failure?.code)
        assertNull(shadowOf(host.get()).nextStartedActivity)

        users.clear()
        shadowOf(app).checkActivities(false)
        login("microsoft")
        assertNotNull(shadowOf(host.get()).nextStartedActivity)
        assertTrue(users.isEmpty())
    }

    @Test
    fun microsoftRedirectWithTheWrongStateIsRejectedOnceAndEndsTheFlow() {
        configureMicrosoft()
        val id = login("microsoft")
        val state = startedMicrosoftUrl().getQueryParameter("state")!!

        AuthAdapter.handleMicrosoftRedirect(redirect("state=forged&code=abc"))
        assertEquals(
            NitroErrorCode.INVALID_STATE to "State mismatch - possible CSRF attack",
            failureOf(users.single()),
        )

        AuthAdapter.handleMicrosoftRedirect(redirect("state=$state&error=access_denied"))
        AuthAdapter.handleMicrosoftRedirect(redirect("state=forged&code=abc"))
        assertEquals(1, users.size)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, id))
    }

    @Test
    fun microsoftRedirectErrorsMapThroughTheSharedTableAndMissingCodeIsATokenError() {
        configureMicrosoft()
        val cases = listOf(
            "error=access_denied&error_description=User%20closed" to (NitroErrorCode.CANCELLED to "User closed"),
            "error=access_denied" to (NitroErrorCode.CANCELLED to "access_denied"),
            "error=interaction_required" to (NitroErrorCode.INTERACTION_REQUIRED to "interaction_required"),
            "error=invalid_grant" to (NitroErrorCode.TOKEN_ERROR to "invalid_grant"),
            "error=brand_new_error" to (NitroErrorCode.UNKNOWN to "brand_new_error"),
            "error=" to (NitroErrorCode.UNKNOWN to ""),
            "" to (NitroErrorCode.TOKEN_ERROR to "No authorization code in response"),
        )
        for ((query, expected) in cases) {
            users.clear()
            login("microsoft")
            val state = startedMicrosoftUrl().getQueryParameter("state")!!
            val suffix = if (query.isEmpty()) "" else "&$query"
            AuthAdapter.handleMicrosoftRedirect(redirect("state=$state$suffix"))
            assertEquals(query, expected, failureOf(users.single()))

            AuthAdapter.handleMicrosoftRedirect(redirect("state=$state$suffix"))
            assertEquals(query, 1, users.size)
        }
    }

    @Test
    fun malformedMicrosoftRedirectsNeverCrashAndAreRejectedAsInvalidState() {
        configureMicrosoft()
        val malformed = listOf(
            "msauth://${app.packageName}/$CLIENT_ID",
            "msauth://${app.packageName}/$CLIENT_ID?",
            "msauth://${app.packageName}/$CLIENT_ID?state",
            "msauth://${app.packageName}/$CLIENT_ID?state=",
            "msauth://${app.packageName}/$CLIENT_ID?code=abc",
            "msauth://${app.packageName}/$CLIENT_ID?state=%zz",
            "msauth://${app.packageName}/$CLIENT_ID#state=fragment",
            "msauth://${app.packageName}/$CLIENT_ID?state=" + "s".repeat(100_000),
        )
        for (uri in malformed) {
            users.clear()
            login("microsoft")
            assertNotNull(shadowOf(app).nextStartedActivity)
            AuthAdapter.handleMicrosoftRedirect(Uri.parse(uri))
            assertEquals(uri.take(80), NitroErrorCode.INVALID_STATE, users.single().failure?.code)
        }
    }

    @Test
    fun redirectForAReplacedOrCancelledFlowIsIgnoredAndTheCurrentFlowStaysPending() {
        configureMicrosoft()
        val first = login("microsoft")
        val firstState = startedMicrosoftUrl().getQueryParameter("state")!!
        val second = login("microsoft")
        val secondState = startedMicrosoftUrl().getQueryParameter("state")!!
        assertNotEquals(firstState, secondState)

        AuthAdapter.handleMicrosoftRedirect(redirect("state=$firstState&error=access_denied"))
        assertTrue(users.isEmpty())

        AuthAdapter.handleMicrosoftRedirect(redirect("state=$secondState&error=access_denied"))
        assertEquals(NitroErrorCode.CANCELLED, users.single().failure?.code)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, second))
        assertTrue(ProviderRequestRegistry.loginError("login", NitroErrorCode.CANCELLED.value, null, first))

        users.clear()
        val third = login("microsoft")
        val thirdState = startedMicrosoftUrl().getQueryParameter("state")!!
        AuthAdapter.cancelPendingOperations()
        AuthAdapter.handleMicrosoftRedirect(redirect("state=$thirdState&error=access_denied"))
        assertTrue(users.isEmpty())
        ProviderRequestRegistry.cancelAll()
        assertEquals(NitroErrorCode.CANCELLED, users.single().failure?.code)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, third))
    }

    @Test
    fun redirectActivitiesStartedAfterProcessDeathFinishWithoutSettlingOrCrashing() {
        configureMicrosoft()
        val intents = listOf(
            Intent(Intent.ACTION_VIEW, redirect("state=stale&code=abc")),
            Intent(Intent.ACTION_VIEW, Uri.parse("https://evil.example/?state=stale&code=abc")),
            Intent(Intent.ACTION_VIEW),
        )
        for (intent in intents) {
            val controller = Robolectric.buildActivity(MicrosoftAuthActivity::class.java, intent).create()
            assertTrue(controller.get().isFinishing)
            controller.newIntent(intent)
            assertTrue(controller.get().isFinishing)
        }

        val appleIntent = Intent(Intent.ACTION_VIEW, Uri.parse("$APPLE_SCHEME://apple/callback?attemptId=$ATTEMPT_ID"))
        val apple = Robolectric.buildActivity(AppleAuthCallbackActivity::class.java, appleIntent).create()
        assertTrue(apple.get().isFinishing)
        assertNull(shadowOf(apple.get()).nextStartedActivity)
        assertFalse(AuthAdapter.handleAppleRedirect(appleIntent.data!!))

        val pickerIntent = GoogleSignInActivity.createIntent(
            app, "google-client-id", arrayOf("email"), null, origin = "login", generation = 42L,
        )
        val restored = Bundle().apply {
            putBoolean("launch_started", true)
            putBoolean("result_delivered", false)
        }
        val picker = Robolectric.buildActivity(GoogleSignInActivity::class.java, pickerIntent).create(restored)
        assertTrue(picker.get().isFinishing)
        val fresh = Robolectric.buildActivity(GoogleSignInActivity::class.java, pickerIntent).create()
        assertTrue(fresh.get().isFinishing)

        assertTrue(users.isEmpty())
        assertNull(shadowOf(app).nextStartedActivity)
    }

    @Test
    fun redirectDeliveredThroughTheActivitySettlesOnceAndTheHostResumeDoesNotCancelAgain() {
        configureMicrosoft()
        val host = resumedHost()
        val id = login("microsoft")
        val state = startedMicrosoftUrl(host.get()).getQueryParameter("state")!!
        host.pause()

        val redirectIntent = Intent(Intent.ACTION_VIEW, redirect("state=$state&error=login_required"))
        val redirectActivity = Robolectric.buildActivity(MicrosoftAuthActivity::class.java, redirectIntent).setup()
        assertTrue(redirectActivity.get().isFinishing)
        assertEquals(NitroErrorCode.INTERACTION_REQUIRED, users.single().failure?.code)

        redirectActivity.pause().stop().destroy()
        host.resume()
        assertEquals(1, users.size)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, id))
    }

    @Test
    fun returningFromTheBrowserWithoutARedirectCancelsTheMicrosoftLoginOnce() {
        configureMicrosoft()
        val host = resumedHost()
        login("microsoft")
        val state = startedMicrosoftUrl(host.get()).getQueryParameter("state")!!
        assertTrue(users.isEmpty())

        host.pause().stop()
        assertTrue(users.isEmpty())
        host.start().resume()
        assertEquals(NitroErrorCode.CANCELLED to "Microsoft sign-in was dismissed", failureOf(users.single()))

        host.pause().resume()
        AuthAdapter.handleMicrosoftRedirect(redirect("state=$state&error=access_denied"))
        assertEquals(1, users.size)
    }

    @Test
    fun appleSignInTimesOutExactlyOnceWhileTheBrokerIsUnresponsive() {
        configureApple()
        val brokerStarted = CountDownLatch(1)
        AuthAdapter.appleBrokerFactory = { config ->
            AppleAndroidBroker(config, connectionFactory = { url ->
                brokerStarted.countDown()
                while (releaseBroker.count > 0) {
                    try {
                        releaseBroker.await()
                    } catch (_: InterruptedException) {
                    }
                }
                ScriptedConnection(url, 500, "{}")
            }, requestTimeoutMs = 3_600_000)
        }
        val id = login("apple", nonce = "a".repeat(64))
        assertTrue(brokerStarted.await(10, TimeUnit.SECONDS))

        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(179_999))
        assertTrue(users.isEmpty())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1))
        assertEquals(NitroErrorCode.TIMEOUT to "Apple sign-in timed out", failureOf(users.single()))

        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(10))
        releaseBroker.countDown()
        idleMain()
        assertEquals(1, users.size)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, id))
        assertFalse(AuthAdapter.handleAppleRedirect(Uri.parse("$APPLE_SCHEME://apple/callback?attemptId=$ATTEMPT_ID")))
    }

    @Test
    fun cancellingAnApplePendingLoginRemovesItsTimeout() {
        configureApple()
        val brokerStarted = CountDownLatch(1)
        AuthAdapter.appleBrokerFactory = { config ->
            AppleAndroidBroker(config, connectionFactory = { url ->
                brokerStarted.countDown()
                while (releaseBroker.count > 0) {
                    try {
                        releaseBroker.await()
                    } catch (_: InterruptedException) {
                    }
                }
                ScriptedConnection(url, 500, "{}")
            }, requestTimeoutMs = 3_600_000)
        }
        val id = login("apple", nonce = "a".repeat(64))
        assertTrue(brokerStarted.await(10, TimeUnit.SECONDS))

        AuthAdapter.cancelPendingOperations()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(10))
        assertTrue(users.isEmpty())

        ProviderRequestRegistry.cancelAll()
        assertEquals(NitroErrorCode.CANCELLED, users.single().failure?.code)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, id))
    }

    @Test
    fun appleSignInWithoutAnActivityIsAConfigurationError() {
        configureApple()
        brokerReturning(startResponse())
        login("apple", nonce = "a".repeat(64))

        awaitUsers(1)
        assertEquals(
            NitroErrorCode.CONFIGURATION_ERROR to "An Activity is required for Apple sign-in",
            failureOf(users.single()),
        )
    }

    @Test
    fun appleSignInWithoutACustomTabsCapableBrowserIsReportedAsPopupBlocked() {
        configureApple()
        val host = resumedHost()
        shadowOf(app).checkActivities(true)
        brokerReturning(startResponse())
        login("apple", nonce = "a".repeat(64))

        awaitUsers(1)
        assertEquals(
            NitroErrorCode.POPUP_BLOCKED to "Could not open Apple sign-in in a browser",
            failureOf(users.single()),
        )
        assertNull(shadowOf(host.get()).nextStartedActivity)
    }

    @Test
    fun appleBrokerFailuresReachTheCallerWithTheirTypedCode() {
        configureApple()
        resumedHost()
        val cases = listOf(
            (500 to "not json") to NitroErrorCode.NETWORK_ERROR,
            (200 to "not json") to NitroErrorCode.PARSE_ERROR,
            (200 to """{"data":{"attemptId":"not-a-uuid","authorizationUrl":"https://appleid.apple.com/auth/authorize"}}""") to
                NitroErrorCode.PARSE_ERROR,
            (200 to """{"data":{"attemptId":"$ATTEMPT_ID","authorizationUrl":"https://evil.example/auth/authorize"}}""") to
                NitroErrorCode.CONFIGURATION_ERROR,
        )
        for ((response, expected) in cases) {
            users.clear()
            brokerReturning(response)
            login("apple", nonce = "a".repeat(64))
            awaitUsers(1)
            assertEquals(response.second, expected, users.single().failure?.code)
        }
    }

    @Test
    fun appleSignInOpensCustomTabsAndCompletesOnceThroughTheCallback() {
        configureApple()
        val host = resumedHost()
        val connections = brokerReturning(
            startResponse(),
            200 to """{"data":{"idToken":"id-token","authorizationCode":"auth-code","user":{"id":"user-id","email":"user@example.test","name":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace"}}}""",
        )
        val id = login("apple", nonce = "a".repeat(64), scopes = arrayOf("email"))

        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var launched: Intent? = null
        while (launched == null && System.nanoTime() < deadline) {
            idleMain()
            launched = shadowOf(host.get()).nextStartedActivity
            Thread.yield()
        }
        assertEquals("https://appleid.apple.com/auth/authorize?client_id=x", launched?.dataString)
        assertTrue(launched!!.hasExtra("android.support.customtabs.extra.SESSION"))
        assertTrue(users.isEmpty())

        val callback = Uri.parse("$APPLE_SCHEME://apple/callback?attemptId=$ATTEMPT_ID")
        assertFalse(AuthAdapter.handleAppleRedirect(Uri.parse("$APPLE_SCHEME://apple/callback?attemptId=${ATTEMPT_ID.uppercase()}")))
        assertFalse(AuthAdapter.handleAppleRedirect(Uri.parse("other://apple/callback?attemptId=$ATTEMPT_ID")))
        assertTrue(AuthAdapter.handleAppleRedirect(callback))
        assertFalse(AuthAdapter.handleAppleRedirect(callback))

        awaitUsers(1)
        val user = users.single().user!!
        assertNull(users.single().failure)
        assertEquals(AuthProvider.APPLE, user.provider)
        assertEquals("id-token", user.idToken)
        assertEquals("auth-code", user.authorizationCode)
        assertEquals("auth-code", user.serverAuthCode)
        assertEquals("user-id", user.userId)
        assertEquals("user@example.test", user.email)
        assertEquals(listOf("email"), user.scopes?.toList())
        assertNull(user.expirationTime)
        assertEquals(2, connections.size)

        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(10))
        assertEquals(1, users.size)
        assertFalse(ProviderRequestRegistry.loginError("login", 1, null, id))
        assertFalse(AuthAdapter.handleAppleRedirect(callback))
    }

    @Test
    fun returningFromTheAppleBrowserWithoutACallbackCancelsOnce() {
        configureApple()
        val host = resumedHost()
        brokerReturning(startResponse())
        login("apple", nonce = "a".repeat(64))
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var launched: Intent? = null
        while (launched == null && System.nanoTime() < deadline) {
            idleMain()
            launched = shadowOf(host.get()).nextStartedActivity
            Thread.yield()
        }
        assertNotNull(launched)

        host.pause().stop()
        assertTrue(users.isEmpty())
        host.start().resume()
        assertEquals(NitroErrorCode.CANCELLED to "Apple sign-in was dismissed", failureOf(users.single()))

        host.pause().resume()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(10))
        assertEquals(1, users.size)
    }

    @Test
    fun providersWithoutASessionOrSupportSettleTokenAndRevocationRequestsOnce() {
        for (provider in listOf("microsoft", "apple", "facebook", "")) {
            revocations.clear()
            val id = ProviderRequestRegistry.registerRevocation { revocations.add(it) }
            AuthAdapter.revokeAccessSync(configuredApp, provider, id)
            assertEquals(provider, NitroErrorCode.UNSUPPORTED_PROVIDER, revocations.single().failure?.code)
            assertFalse(ProviderRequestRegistry.revokeResult(null, null, id))
        }
        assertTrue(tokens.isEmpty())
    }
}

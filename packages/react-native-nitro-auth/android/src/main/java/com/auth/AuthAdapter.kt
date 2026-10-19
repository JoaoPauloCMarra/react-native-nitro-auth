@file:Suppress("DEPRECATION")

package com.auth

import com.margelo.nitro.com.auth.AuthNonce
import com.margelo.nitro.com.auth.AuthProvider
import com.margelo.nitro.com.auth.ProviderRequestRegistry

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.Credential
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.LinkedHashMap
import java.security.SecureRandom
import java.util.UUID

object AuthAdapter {
    private const val TAG = "AuthAdapter"
    private const val APPLE_AUTH_TIMEOUT_MS = 180_000L
    private val nonceRandom = SecureRandom()
    private val defaultMicrosoftScopes =
        listOf("openid", "email", "profile", "offline_access", "User.Read")

    private class OneTapSession(
        val credential: GoogleIdTokenCredential,
        val scopes: List<String>,
        val hostedDomain: String?,
    )

    private data class PendingAppleAuth(
        val origin: Origin,
        val generation: Long,
        val config: AppleAndroidBrokerConfig,
        val codeVerifier: String,
        val scopes: List<String>,
        var attemptId: String? = null,
        var browserWasOpened: Boolean = false,
        var callbackReceived: Boolean = false,
    )

    private data class ClearedAppleAuth(
        val pending: PendingAppleAuth,
        val job: Job?,
        val timeoutRunnable: Runnable?,
    )

    private data class GoogleCredentialCleanup(
        val generation: Long,
        val stateEpoch: Long,
        val completion: CompletableDeferred<Unit>,
        var externalCallStarted: Boolean = false,
    )

    @Volatile
    private var isInitialized = false

    private var appContext: Context? = null
    private val activityTracker = AuthActivityTracker()
    private val currentActivity: Activity?
        get() = activityTracker.currentActivity()
    private var lifecycleCallbacks: Application.ActivityLifecycleCallbacks? = null
    private val knownMicrosoftStates = LinkedHashMap<String, Long>()

    private var microsoftResumeSuppressionGeneration: Long? = null

    @Volatile
    private var pendingMicrosoft: PendingMicrosoftAuth? = null
    @Volatile
    private var googleSessionState = GoogleSessionState(null)
    private val pendingGoogleLogin = PendingOperation()
    private val pendingGoogleScopes = PendingOperation()
    private val pendingGoogleRefresh = PendingOperation()
    private val pendingGoogleSilent = PendingOperation()
    private var googleAuthStateEpoch = 1L
    private val googlePickerOperationState = GooglePickerOperationState()
    private val googlePickerRetryHandler by lazy { Handler(Looper.getMainLooper()) }
    private val appleAuthTimeoutHandler by lazy { Handler(Looper.getMainLooper()) }
    @Volatile
    private var pendingAppleAuth: PendingAppleAuth? = null
    private var appleBrokerJob: Job? = null
    private var appleAuthTimeoutRunnable: Runnable? = null
    private var appleResumeSuppressionGeneration: Long? = null
    private var googleLegacyAccountNeedsRevalidation = false
    private val googleRevokeState = GoogleRevokeState()
    @JvmField
    internal var appleBrokerFactory: (AppleAndroidBrokerConfig) -> AppleAndroidBroker = { AppleAndroidBroker(it) }
    private var googleCredentialCleanup: GoogleCredentialCleanup? = null
    @Volatile
    private var inMemoryOneTapSession: OneTapSession? = null

    @Volatile
    private var inMemoryMicrosoftRefreshToken: String? = null
    @Volatile
    private var inMemoryMicrosoftTenant: String? = null
    @Volatile
    private var inMemoryMicrosoftScopes: List<String> =
        defaultMicrosoftScopes
    private val pendingMicrosoftRefresh = PendingOperation()
    private val pendingMicrosoftSilent = PendingOperation()

    private var moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)


    private fun nativeOnLoginSuccess(origin: Origin, user: ProviderUserFields, generation: Long): Boolean =
        ProviderRequestRegistry.loginSuccess(
            origin, user.provider, user.email, user.name, user.firstName, user.lastName, user.photo,
            user.idToken, user.accessToken, user.serverAuthCode, user.userId, user.phoneNumber,
            user.hostedDomain, user.scopes, user.expirationTime, generation,
        )

    private fun nativeOnLoginError(origin: Origin, code: Int, underlyingError: String?, generation: Long): Boolean = ProviderRequestRegistry.loginError(origin, code, underlyingError, generation)

    fun createNonce(): AuthNonce {
        val randomBytes = ByteArray(32)
        nonceRandom.nextBytes(randomBytes)
        val raw = Base64.encodeToString(
            randomBytes,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
        )
        val hashed = Sha256.hex(raw)
        return AuthNonce(raw, hashed)
    }

    private fun nativeOnRefreshSuccess(idToken: String?, accessToken: String?, expirationTime: Long?, generation: Long): Boolean = ProviderRequestRegistry.refreshSuccess(idToken, accessToken, expirationTime, generation)

    private fun nativeOnRefreshError(code: Int, underlyingError: String?, generation: Long): Boolean = ProviderRequestRegistry.refreshError(code, underlyingError, generation)
    private fun nativeOnRevokeAccessResult(code: Int?, underlyingError: String?, generation: Long): Boolean = ProviderRequestRegistry.revokeResult(code, underlyingError, generation)

    @Synchronized
    fun initialize(context: Context) {
        if (isInitialized) return

        val applicationContext = context.applicationContext
        appContext = applicationContext
        restoreDurableGoogleState(applicationContext)

        val app = applicationContext as? Application
        if (app != null && lifecycleCallbacks == null) {
            lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { activityTracker.onActivityCreated(activity) }
                override fun onActivityStarted(activity: Activity) { activityTracker.onActivityStarted(activity) }
                override fun onActivityResumed(activity: Activity) {
                    activityTracker.onActivityResumed(activity)
                    val isAppleRedirectHandler = activity is AppleAuthCallbackActivity
                    val appleSuppressed = synchronized(this@AuthAdapter) {
                        val generation = pendingAppleAuth?.generation
                        when {
                            isAppleRedirectHandler && generation != null -> {
                                appleResumeSuppressionGeneration = generation
                                true
                            }
                            shouldConsumeBrowserResumeSuppression(
                                resumeSuppressionGeneration = appleResumeSuppressionGeneration,
                                currentGeneration = generation,
                                resumingActivityIsCallbackHandler = isAppleRedirectHandler,
                            ) -> {
                                appleResumeSuppressionGeneration = null
                                true
                            }
                            else -> false
                        }
                    }
                    if (appleSuppressed) return

                    val isRedirectHandler = activity is MicrosoftAuthActivity
                    val suppressed = synchronized(this@AuthAdapter) {
                        val generation = pendingMicrosoft?.generation
                        if (shouldConsumeBrowserResumeSuppression(
                                resumeSuppressionGeneration = microsoftResumeSuppressionGeneration,
                                currentGeneration = generation,
                                resumingActivityIsCallbackHandler = isRedirectHandler,
                        )
                        ) {
                            microsoftResumeSuppressionGeneration = null
                            true
                        } else {
                            false
                        }
                    }
                    if (suppressed) {
                        return
                    }
                    val cancellation = synchronized(this@AuthAdapter) {
                        val pending = pendingMicrosoft
                        if (pending == null || !shouldCancelBrowserFlow(
                                authInProgress = true,
                                browserWasOpened = pending.browserWasOpened,
                                callbackReceived = pending.redirectReceived,
                                resumingActivityIsCallbackHandler = isRedirectHandler,
                                resumeSuppressionGeneration = microsoftResumeSuppressionGeneration,
                                currentGeneration = pending.generation,
                        )
                        ) {
                            null
                        } else {
                            clearPkceStateLocked()
                            pending.origin to pending.generation
                        }
                    }
                    cancellation?.let { (origin, generation) ->
                        nativeOnLoginError(
                            origin,
                            AuthErrorCode.CANCELLED.code,
                            "Microsoft sign-in was dismissed",
                            generation,
                        )
                    }

                    val appleCancellationGeneration = synchronized(this@AuthAdapter) {
                        val pending = pendingAppleAuth
                        if (pending != null &&
                            shouldCancelBrowserFlow(
                                authInProgress = pendingAppleAuth != null,
                                browserWasOpened = pending.browserWasOpened,
                                callbackReceived = pending.callbackReceived,
                                resumingActivityIsCallbackHandler = isAppleRedirectHandler,
                                resumeSuppressionGeneration = appleResumeSuppressionGeneration,
                                currentGeneration = pending.generation,
                            )
                        ) pending.generation else null
                    }
                    appleCancellationGeneration?.let {
                        failAppleAuth(it, AuthErrorCode.CANCELLED, "Apple sign-in was dismissed")
                    }
                }
                override fun onActivityPaused(activity: Activity) {
                    pendingMicrosoft?.browserWasOpened = true
                    activityTracker.onActivityPaused(activity)
                }
                override fun onActivityStopped(activity: Activity) { activityTracker.onActivityStopped(activity) }
                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
                override fun onActivityDestroyed(activity: Activity) { activityTracker.onActivityDestroyed(activity) }
            }
            app.registerActivityLifecycleCallbacks(lifecycleCallbacks)
        }
        val reactContext = context as? ReactApplicationContext
        val hostActivity = if (reactContext?.lifecycleState == LifecycleState.RESUMED) {
            reactContext.currentActivity
        } else {
            null
        }
        activityTracker.seed(hostActivity)

        isInitialized = true;
    }

    fun dispose() {
        beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        synchronized(this) {
            knownMicrosoftStates.clear()
            microsoftResumeSuppressionGeneration = null
        }
        moduleScope.cancel()
        moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        ProviderRequestRegistry.cancelAll()

        val app = appContext as? Application
        lifecycleCallbacks?.let { app?.unregisterActivityLifecycleCallbacks(it) }
        lifecycleCallbacks = null
        activityTracker.clear()
        appContext = null
        googleLegacyAccountNeedsRevalidation = true
        googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        googleCredentialCleanup = null
        inMemoryOneTapSession = null
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftTenant = null
        inMemoryMicrosoftScopes = defaultMicrosoftScopes
        isInitialized = false
    }

    @JvmStatic
    fun cancelPendingOperations() {
        beginGoogleAuthStateTransition(clearPendingCallbacks = true)
    }

    @JvmStatic
    internal fun registerGooglePickerActivity(activity: Activity, origin: Origin, generation: Long): Boolean = synchronized(this) {
        val stateEpoch = googlePickerStateEpochLocked(origin, generation) ?: return@synchronized false
        if (origin == Origin.LOGIN) {
            googleLegacyAccountNeedsRevalidation = true
        }
        googlePickerOperationState.register(activity, origin, generation, stateEpoch)
    }

    @JvmStatic
    internal fun claimGooglePickerLaunch(activity: Activity, origin: Origin, generation: Long): Boolean = synchronized(this) {
        val stateEpoch = googlePickerStateEpochLocked(origin, generation) ?: return@synchronized false
        googlePickerOperationState.claimLaunch(activity, origin, generation, stateEpoch)
    }

    @JvmStatic
    internal fun beginGooglePickerSignOut(activity: Activity, origin: Origin, generation: Long): GooglePickerSignOutDecision = synchronized(this) {
        val stateEpoch = googlePickerStateEpochLocked(origin, generation)
            ?: return@synchronized GooglePickerSignOutDecision.REJECT
        googlePickerOperationState.beginSignOut(activity, origin, generation, stateEpoch)
    }

    @JvmStatic
    fun completeGooglePickerSignOut(activity: Activity, successful: Boolean) {
        val result = synchronized(this) {
            googlePickerOperationState.completeSignOut(activity, successful)
        } ?: return
        notifyGooglePickerSignOutChange(result)
    }

    @JvmStatic
    internal fun unregisterGooglePickerActivity(activity: Activity, origin: Origin, generation: Long) {
        synchronized(this) {
            googlePickerOperationState.unregister(activity, origin, generation)
        }
    }

    @JvmStatic
    fun cleanupStaleGoogleSignInResult(context: Context, account: GoogleSignInAccount) {
        cleanupStaleGoogleAccount(context, account)
    }

    private fun notifyGooglePickerSignOutChange(result: GooglePickerSignOutResult) {
        (result.activeIdentity as? GoogleSignInActivity)?.let { activity ->
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    activity.onGooglePickerSignOutChanged()
                }
            }
        }
        result.retryAtMillis?.let { retryAtMillis ->
            val delayMillis = (retryAtMillis - System.currentTimeMillis()).coerceAtLeast(0L)
            googlePickerRetryHandler.postDelayed({ retryPendingGoogleSdkSignOut() }, delayMillis)
        }
    }

    private fun retryPendingGoogleSdkSignOut() {
        val context = appContext ?: return
        val owner = synchronized(this) { googlePickerOperationState.cleanupOwner() } ?: return
        val decision = synchronized(this) {
            googlePickerOperationState.retrySignOut(owner)
        }
        if (decision != GooglePickerSignOutDecision.START) return
        startGoogleSdkSignOut(context, owner)
    }

    private fun startGoogleSdkSignOut(context: Context, owner: Any) {
        val targetAccountId = synchronized(this) {
            googlePickerOperationState.cleanupTargetAccountId()
        }
        @Suppress("DEPRECATION")
        val currentAccount = GoogleSignIn.getLastSignedInAccount(context)
        if (targetAccountId != null && currentAccount?.id != targetAccountId) {
            completeGoogleSdkSignOut(owner, successful = true)
            return
        }
        val client = getLegacyGoogleClient(context)
        if (client == null) {
            completeGoogleSdkSignOut(owner, successful = false)
            return
        }
        client.signOut().addOnCompleteListener { task ->
            completeGoogleSdkSignOut(owner, task.isSuccessful)
        }
    }

    private fun completeGoogleSdkSignOut(owner: Any, successful: Boolean) {
        val result = synchronized(this) {
            googlePickerOperationState.completeSignOut(owner, successful)
        } ?: return
        notifyGooglePickerSignOutChange(result)
    }

    internal fun onSignInSuccess(
        account: GoogleSignInAccount,
        scopes: List<String>,
        origin: Origin = Origin.LOGIN,
        hostedDomain: String? = null,
        generation: Long,
    ): Boolean {
        val context = appContext ?: return false
        if (!synchronized(this) { acceptsPendingGoogleGenerationLocked(origin, generation) }) {
            cleanupStaleGoogleAccount(context, account)
            return false
        }
        val user = googleUserFrom(account, hostedDomain, scopes.toTypedArray())
        if (!nativeOnLoginSuccess(origin, user, generation)) {
            cleanupStaleGoogleAccount(context, account)
            return false
        }
        val committed = synchronized(this) {
            if (!acceptsPendingGoogleGenerationLocked(origin, generation)) {
                false
            } else {
                clearPendingGoogleGenerationLocked(origin)
                googleLegacyAccountNeedsRevalidation = false
                googlePickerOperationState.markSdkAccountEstablished()
                googleSessionState = GoogleSessionState(
                    requestedHostedDomain = hostedDomain,
                    accountId = account.id,
                    kind = GoogleSessionKind.LEGACY,
                )
                inMemoryOneTapSession = null
                inMemoryMicrosoftRefreshToken = null
                inMemoryMicrosoftTenant = null
                inMemoryMicrosoftScopes = defaultMicrosoftScopes
                GoogleSessionStore.persistLocked(context, googleSessionState)
                true
            }
        }
        if (!committed) {
            cleanupStaleGoogleAccount(context, account)
        }
        return committed
    }

    internal fun onSignInError(errorCode: Int, message: String?, origin: Origin = Origin.LOGIN, generation: Long) {
        if (!consumeGoogleGeneration(origin, generation)) return
        val mappedError = mapGoogleStatusCode(errorCode)
        nativeOnLoginError(origin, mappedError.code, message, generation)
    }

    internal fun loginSync(context: Context, request: LoginRequest, generation: Long) {
        val cleanupBarrier = beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        if (request.provider == AuthProvider.APPLE) {
            loginApple(context, request.scopes, request.nonce, generation, cleanupBarrier)
            return
        }
        if (request.provider == AuthProvider.MICROSOFT) {
            loginMicrosoft(context, request.scopes, request.loginHint, request.tenant, request.prompt, Origin.LOGIN, generation)
            return
        }

        val loginStateEpoch = synchronized(this) {
            pendingGoogleLogin.begin(generation, googleAuthStateEpoch)
            googleAuthStateEpoch
        }

        val ctx = appContext ?: context.applicationContext
        val clientId = getClientIdFromResources(ctx)
        if (clientId == null) {
            if (consumeGoogleGeneration(Origin.LOGIN, generation)) {
                nativeOnLoginError(Origin.LOGIN, AuthErrorCode.CONFIGURATION_ERROR.code, "Google Client ID is required. Set it in app.json plugins.", generation)
            }
            return
        }

        val requestedScopes = request.scopes?.toList() ?: listOf("email", "profile")

        val startLogin = {
            if (isCurrentGoogleGeneration(Origin.LOGIN, generation) && isCurrentGoogleStateEpoch(loginStateEpoch)) {
                if (request.nonce == null && (request.useLegacyGoogleSignIn || request.forceAccountPicker)) {
                    loginLegacy(context, clientId, requestedScopes, request, Origin.LOGIN, generation)
                } else {
                    loginOneTap(context, clientId, requestedScopes, request, Origin.LOGIN, generation)
                }
            }
        }
        if (cleanupBarrier == null) {
            startLogin()
        } else {
            moduleScope.launch(Dispatchers.Main) {
                cleanupBarrier.await()
                startLogin()
            }
        }
    }

    private fun loginApple(
        context: Context,
        scopes: Array<String>?,
        nonce: String?,
        generation: Long,
        cleanupBarrier: Deferred<Unit>?,
    ) {
        val ctx = appContext ?: context.applicationContext
        val config = AppleAndroidBrokerConfig.parse(
            baseUrl = stringResource(ctx, "nitro_auth_apple_android_broker_url"),
            callbackScheme = stringResource(ctx, "nitro_auth_apple_android_callback_scheme"),
        )
        if (config == null) {
            nativeOnLoginError(
                Origin.LOGIN,
                AuthErrorCode.CONFIGURATION_ERROR.code,
                "Apple Android broker URL and callback scheme are required. Set them in app.json plugins.",
                generation,
            )
            return
        }

        val hashedNonce = nonce ?: createNonce().hashed
        if (!Regex("^[a-f0-9]{64}$").matches(hashedNonce)) {
            nativeOnLoginError(
                Origin.LOGIN,
                AuthErrorCode.INVALID_NONCE.code,
                "Apple nonce must be a 64-character SHA-256 hex value",
                generation,
            )
            return
        }

        val code = try {
            createAppleCodePair()
        } catch (_: Exception) {
            nativeOnLoginError(
                Origin.LOGIN,
                AuthErrorCode.UNKNOWN.code,
                "Could not create Apple PKCE challenge",
                generation,
            )
            return
        }
        val pending = PendingAppleAuth(
            origin = Origin.LOGIN,
            generation = generation,
            config = config,
            codeVerifier = code.verifier,
            scopes = scopes?.toList() ?: listOf("email", "fullName"),
        )
        val timeoutRunnable = Runnable {
            failAppleAuth(generation, AuthErrorCode.TIMEOUT, "Apple sign-in timed out")
        }
        synchronized(this) {
            if (pendingAppleAuth != null) {
                nativeOnLoginError(
                    Origin.LOGIN,
                    AuthErrorCode.OPERATION_IN_PROGRESS.code,
                    "Apple authentication is already in progress",
                    generation,
                )
                return
            }
            pendingAppleAuth = pending
            appleResumeSuppressionGeneration = null
            appleAuthTimeoutRunnable = timeoutRunnable
        }
        appleAuthTimeoutHandler.postDelayed(timeoutRunnable, APPLE_AUTH_TIMEOUT_MS)

        val job = moduleScope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                cleanupBarrier?.await()
                if (!isCurrentAppleAuth(pending)) return@launch

                val broker = appleBrokerFactory(config)
                val attempt = broker.start(hashedNonce, code.challenge, pending.scopes)
                val launched = withContext(Dispatchers.Main) {
                    val activity = currentActivity
                        ?: throw AppleAndroidBrokerException(
                            AuthErrorCode.CONFIGURATION_ERROR,
                            "An Activity is required for Apple sign-in",
                        )
                    val shouldLaunch = synchronized(this@AuthAdapter) {
                        if (pendingAppleAuth === pending && !pending.callbackReceived) {
                            pending.attemptId = attempt.attemptId
                            pending.browserWasOpened = true
                            true
                        } else {
                            false
                        }
                    }
                    if (!shouldLaunch) return@withContext false
                    try {
                        CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(attempt.authorizationUrl))
                    } catch (_: android.content.ActivityNotFoundException) {
                        throw AppleAndroidBrokerException(
                            AuthErrorCode.POPUP_BLOCKED,
                            "Could not open Apple sign-in in a browser",
                        )
                    }
                    true
                }
                if (!launched) return@launch
            } catch (_: CancellationException) {
                // Cancellation and timeout have already cleared this attempt.
            } catch (error: AppleAndroidBrokerException) {
                withContext(Dispatchers.Main) {
                    failAppleAuth(pending.generation, error.authErrorCode, error.message)
                }
            } catch (_: Exception) {
                withContext(Dispatchers.Main) {
                    failAppleAuth(pending.generation, AuthErrorCode.NETWORK_ERROR, "Apple sign-in failed")
                }
            }
        }
        synchronized(this) {
            if (pendingAppleAuth === pending) {
                appleBrokerJob = job
            } else {
                job.cancel()
            }
        }
        job.start()
    }

    private fun isCurrentAppleAuth(pending: PendingAppleAuth): Boolean = synchronized(this) {
        pendingAppleAuth === pending
    }

    private fun clearPendingAppleAuth(
        generation: Long? = null,
        cancelNetwork: Boolean = true,
    ): PendingAppleAuth? {
        val cleared = synchronized(this) {
            val pending = pendingAppleAuth ?: return null
            if (generation != null && pending.generation != generation) return null
            ClearedAppleAuth(pending, appleBrokerJob, appleAuthTimeoutRunnable).also {
                pendingAppleAuth = null
                appleBrokerJob = null
                appleAuthTimeoutRunnable = null
                appleResumeSuppressionGeneration = null
            }
        }
        cleared.timeoutRunnable?.let(appleAuthTimeoutHandler::removeCallbacks)
        if (cancelNetwork) cleared.job?.cancel()
        return cleared.pending
    }

    private fun failAppleAuth(generation: Long, code: AuthErrorCode, message: String?) {
        val pending = clearPendingAppleAuth(generation) ?: return
        nativeOnLoginError(pending.origin, code.code, message, pending.generation)
    }

    @JvmStatic
    fun handleAppleRedirect(uri: Uri): Boolean {
        val current = synchronized(this) {
            val pending = pendingAppleAuth ?: return false
            val decision = classifyAppleCallback(
                callbackUrl = uri.toString(),
                expectedScheme = pending.config.callbackScheme,
                currentAttemptId = pending.attemptId,
                alreadyHandled = pending.callbackReceived,
            )
            if (decision == AppleCallbackDecision.CURRENT) {
                pending.callbackReceived = true
                pending to pending.attemptId!!
            } else {
                null
            }
        } ?: return false

        val (pending, attemptId) = current
        val job = moduleScope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                val credential = appleBrokerFactory(pending.config)
                    .complete(attemptId, pending.codeVerifier)
                withContext(Dispatchers.Main) {
                    val active = synchronized(this@AuthAdapter) {
                        pendingAppleAuth === pending && pending.callbackReceived
                    }
                    if (!active) return@withContext
                    val completed = clearPendingAppleAuth(pending.generation, cancelNetwork = false)
                        ?: return@withContext
                    nativeOnLoginSuccess(
                        completed.origin,
                        ProviderUserFields(
                            provider = AuthProvider.APPLE,
                            email = credential.email,
                            name = credential.name,
                            firstName = credential.firstName,
                            lastName = credential.lastName,
                            idToken = credential.idToken,
                            serverAuthCode = credential.authorizationCode,
                            userId = credential.userId,
                            scopes = completed.scopes.toTypedArray(),
                        ),
                        completed.generation,
                    )
                }
            } catch (_: CancellationException) {
                // Cancellation and timeout have already cleared this attempt.
            } catch (error: AppleAndroidBrokerException) {
                withContext(Dispatchers.Main) {
                    failAppleAuth(pending.generation, error.authErrorCode, error.message)
                }
            } catch (_: Exception) {
                withContext(Dispatchers.Main) {
                    failAppleAuth(pending.generation, AuthErrorCode.NETWORK_ERROR, "Apple sign-in failed")
                }
            }
        }
        synchronized(this) {
            if (pendingAppleAuth === pending) {
                appleBrokerJob = job
            } else {
                job.cancel()
            }
        }
        job.start()
        return true
    }

    private fun loginMicrosoft(context: Context, scopes: Array<String>?, loginHint: String?, tenant: String?, prompt: String?, origin: Origin = Origin.LOGIN, generation: Long) {
        val ctx = appContext ?: context.applicationContext
        val clientId = getMicrosoftClientIdFromResources(ctx)
        if (clientId == null) {
            nativeOnLoginError(origin, AuthErrorCode.CONFIGURATION_ERROR.code, "Microsoft Client ID is required. Set it in app.json plugins.", generation)
            return
        }
        val effectiveTenant = tenant ?: getMicrosoftTenantFromResources(ctx) ?: "common"
        val effectiveScopes = scopes?.toList() ?: defaultMicrosoftScopes
        val effectivePrompt = prompt ?: "select_account"

        synchronized(this) {
            if (pendingMicrosoft != null) {
                nativeOnLoginError(
                    origin,
                    AuthErrorCode.OPERATION_IN_PROGRESS.code,
                    "Microsoft authentication already in progress",
                    generation,
                )
                return
            }
            microsoftResumeSuppressionGeneration = null
            pendingMicrosoft = PendingMicrosoftAuth(origin, generation, effectiveScopes)
        }

        val codeVerifier = generateCodeVerifier()
        val codeChallenge = generateCodeChallenge(codeVerifier)
        val state = UUID.randomUUID().toString()
        val nonce = UUID.randomUUID().toString()

        val b2cDomain = getMicrosoftB2cDomainFromResources(ctx)
        val authBaseUrl = MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(effectiveTenant, b2cDomain)
        if (authBaseUrl == null) {
            clearPkceState()
            nativeOnLoginError(origin, AuthErrorCode.CONFIGURATION_ERROR.code, "Invalid Microsoft tenant or B2C domain", generation)
            return
        }

        synchronized(this) {
            pendingMicrosoft?.let {
                it.verifier = codeVerifier
                it.state = state
                it.nonce = nonce
                it.tenant = effectiveTenant
                it.clientId = clientId
                it.b2cDomain = b2cDomain
            }
            rememberMicrosoftStateLocked(state, generation)
        }
        val redirectUri = microsoftRedirectUri(ctx, clientId)

        val authUrl = Uri.parse("${authBaseUrl}oauth2/v2.0/authorize").buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("response_mode", "query")
            .appendQueryParameter("scope", effectiveScopes.joinToString(" "))
            .appendQueryParameter("state", state)
            .appendQueryParameter("nonce", nonce)
            .appendQueryParameter("code_challenge", codeChallenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("prompt", effectivePrompt)
            .apply { if (loginHint != null) appendQueryParameter("login_hint", loginHint) }
            .build()

        try {
            val activity = currentActivity
            if (activity != null) {
                val customTabsIntent = CustomTabsIntent.Builder().build()
                customTabsIntent.launchUrl(activity, authUrl)
            } else {
                val browserIntent = Intent(Intent.ACTION_VIEW, authUrl)
                browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(browserIntent)
            }
        } catch (e: Exception) {
            clearPkceState()
            nativeOnLoginError(origin, AuthErrorCode.UNKNOWN.code, e.message, generation)
        }
    }

    private fun generateCodeVerifier(): String {
        val bytes = ByteArray(32)
        java.security.SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private fun generateCodeChallenge(verifier: String): String {
        return Sha256.base64Url(verifier)
    }

    @JvmStatic
    fun handleMicrosoftRedirect(uri: Uri) {
        val callbackState = uri.getQueryParameter("state")
        val claim = synchronized(this) {
            val pending = pendingMicrosoft
            val currentGeneration = pending?.generation
            val decision = classifyMicrosoftRedirect(
                currentState = pending?.state,
                currentGeneration = currentGeneration,
                callbackState = callbackState,
                redirectReceived = pending?.redirectReceived ?: false,
                knownStates = knownMicrosoftStates,
            )
            when (decision) {
                MicrosoftRedirectDecision.STALE -> {
                    microsoftResumeSuppressionGeneration =
                        microsoftResumeSuppressionFor(decision, currentGeneration)
                    null
                }
                MicrosoftRedirectDecision.CURRENT,
                MicrosoftRedirectDecision.INVALID -> {
                    microsoftResumeSuppressionGeneration = null
                    if (pending == null) {
                        null
                    } else {
                        pending.redirectReceived = true
                        MicrosoftRedirectClaim(
                            generation = pending.generation,
                            origin = pending.origin,
                            stateIsValid = decision == MicrosoftRedirectDecision.CURRENT,
                        )
                    }
                }
                MicrosoftRedirectDecision.DUPLICATE,
                MicrosoftRedirectDecision.NO_ACTIVE_FLOW -> null
            }
        } ?: return

        val generation = claim.generation
        val origin = claim.origin
        val code = uri.getQueryParameter("code")
        val error = uri.getQueryParameter("error")
        val errorDescription = uri.getQueryParameter("error_description")

        if (!claim.stateIsValid) {
            if (!clearPkceStateIfCurrent(generation)) return
            nativeOnLoginError(origin, AuthErrorCode.INVALID_STATE.code, "State mismatch - possible CSRF attack", generation)
            return
        }
        if (error != null) {
            if (!clearPkceStateIfCurrent(generation)) return
            val mappedError = MicrosoftAuthConfig.mapMicrosoftOAuthError(error, "authorize")
            nativeOnLoginError(origin, mappedError.code, errorDescription ?: error, generation)
            return
        }
        if (code == null) {
            if (!clearPkceStateIfCurrent(generation)) return
            nativeOnLoginError(origin, AuthErrorCode.TOKEN_ERROR.code, "No authorization code in response", generation)
            return
        }
        exchangeCodeForTokens(code, generation)
    }

    private fun exchangeCodeForTokens(code: String, generation: Long) {
        val ctx = appContext ?: return
        val snapshot = synchronized(this) {
            val pending = pendingMicrosoft
            if (pending == null || !isCurrentMicrosoftGenerationLocked(generation)) {
                null
            } else {
                val clientId = pending.clientId
                val tenant = pending.tenant
                val verifier = pending.verifier
                if (clientId == null || tenant == null || verifier == null || pending.nonce == null) {
                    null
                } else {
                    MicrosoftExchangeSnapshot(
                        origin = pending.origin,
                        clientId = clientId,
                        tenant = tenant,
                        b2cDomain = pending.b2cDomain,
                        verifier = verifier,
                        scopes = pending.scopes.ifEmpty { defaultMicrosoftScopes },
                    )
                }
            }
        }
        if (snapshot == null) {
            val origin = synchronized(this) {
                if (!isCurrentMicrosoftGenerationLocked(generation)) null else pendingMicrosoft?.origin
            }
            if (origin != null && nativeOnLoginError(origin, AuthErrorCode.INVALID_STATE.code, "Missing PKCE state for token exchange", generation)) {
                completeMicrosoftFailure(generation)
            }
            return
        }

        val redirectUri = microsoftRedirectUri(ctx, snapshot.clientId)
        val authBaseUrl = MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(snapshot.tenant, snapshot.b2cDomain)
        if (authBaseUrl == null) {
            if (nativeOnLoginError(snapshot.origin, AuthErrorCode.CONFIGURATION_ERROR.code, "Invalid Microsoft tenant or B2C domain", generation)) {
                completeMicrosoftFailure(generation)
            }
            return
        }
        val tokenUrl = microsoftTokenUrl(authBaseUrl)

        postForm(
            url = tokenUrl,
            params = linkedMapOf(
                "client_id" to snapshot.clientId,
                "code" to code,
                "redirect_uri" to redirectUri,
                "grant_type" to "authorization_code",
                "code_verifier" to snapshot.verifier,
            ),
            onResult = { responseCode, responseBody ->
                completeMicrosoftTokenResponse(responseCode, responseBody, generation, snapshot.scopes)?.let { completion ->
                    if (completion.success) {
                        val nativeAccepted = nativeOnLoginSuccess(
                            completion.origin,
                            ProviderUserFields(
                                provider = AuthProvider.MICROSOFT,
                                email = completion.email,
                                name = completion.name,
                                idToken = completion.idToken,
                                accessToken = completion.accessToken,
                                scopes = completion.scopes.toTypedArray(),
                                expirationTime = completion.expirationTime,
                            ),
                            completion.generation,
                        )
                        if (nativeAccepted && commitMicrosoftTokenSuccess(completion)) {
                            appContext?.let { getLegacyGoogleClient(it)?.signOut() }
                        } else if (!nativeAccepted) {
                            completeMicrosoftFailure(completion.generation)
                        }
                    } else {
                        val nativeAccepted = nativeOnLoginError(
                            completion.origin,
                            completion.code.code,
                            completion.detail,
                            completion.generation,
                        )
                        if (nativeAccepted) completeMicrosoftFailure(completion.generation)
                    }
                }
            },
            onNetworkError = { message ->
                if (nativeOnLoginError(snapshot.origin, AuthErrorCode.NETWORK_ERROR.code, message, generation)) {
                    completeMicrosoftFailure(generation)
                }
            },
        )
    }

    private fun postForm(
        url: String,
        params: Map<String, String>,
        onResult: (Int, String) -> Unit,
        onNetworkError: (String?) -> Unit,
    ) {
        moduleScope.launch {
            try {
                val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                try {
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 15_000
                    connection.requestMethod = "POST"
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    connection.doOutput = true

                    val postData = params.entries.joinToString("&") { (key, value) ->
                        "${key}=${java.net.URLEncoder.encode(value, "UTF-8")}"
                    }
                    connection.outputStream.use { it.write(postData.toByteArray()) }

                    val responseCode = connection.responseCode
                    val responseBody = if (responseCode == 200) {
                        connection.inputStream.bufferedReader().use { it.readText() }
                    } else {
                        connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    }

                    withContext(Dispatchers.Main) {
                        onResult(responseCode, responseBody)
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (_: CancellationException) {
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    onNetworkError(e.message)
                }
            }
        }
    }

    private fun mapMicrosoftRefreshFailure(responseBody: String): Pair<AuthErrorCode, String> {
        return try {
            val json = JSONObject(responseBody)
            val errorCode = json.optString("error", "token_error")
            val errorDesc = json.optString("error_description", "Token refresh failed")
            Pair(MicrosoftAuthConfig.mapMicrosoftOAuthError(errorCode, "refresh"), errorDesc)
        } catch (e: Exception) {
            Pair(AuthErrorCode.REFRESH_FAILED, "Token refresh failed")
        }
    }

    private fun completeMicrosoftFailure(generation: Long): Boolean = synchronized(this) {
        if (!isCurrentMicrosoftGenerationLocked(generation)) return@synchronized false
        clearPkceStateLocked()
        true
    }

    internal fun completeMicrosoftTokenResponse(
        responseCode: Int,
        responseBody: String,
        generation: Long,
        requestedScopes: List<String>,
    ): MicrosoftTokenCompletion? = synchronized(this) {
        if (!isCurrentMicrosoftGenerationLocked(generation)) return@synchronized null
        val pending = pendingMicrosoft ?: return@synchronized null
        val origin = pending.origin
        val expectedNonce = pending.nonce
        val grantedScopes = requestedScopes

        if (responseCode != 200) {
            val failure = try {
                val json = JSONObject(responseBody)
                val error = json.optString("error", "token_error")
                MicrosoftTokenCompletion(
                    origin = origin,
                    generation = generation,
                    success = false,
                    code = MicrosoftAuthConfig.mapMicrosoftOAuthError(error, "token"),
                    detail = json.optString("error_description", "Failed to exchange code for tokens"),
                )
            } catch (error: Exception) {
                MicrosoftTokenCompletion(
                    origin = origin,
                    generation = generation,
                    success = false,
                    code = AuthErrorCode.TOKEN_ERROR,
                    detail = "Failed to exchange code for tokens",
                )
            }
            return@synchronized failure
        }

        try {
            val response = parseMicrosoftTokenResponse(responseBody)
            if (response.idToken == null) {
                return@synchronized MicrosoftTokenCompletion(
                    origin = origin,
                    generation = generation,
                    success = false,
                    code = AuthErrorCode.NO_ID_TOKEN,
                    detail = "No id_token in token response",
                )
            }

            val loginTenant = pending.tenant
            if (response.claims["nonce"] != expectedNonce) {
                return@synchronized MicrosoftTokenCompletion(
                    origin = origin,
                    generation = generation,
                    success = false,
                    code = AuthErrorCode.INVALID_NONCE,
                    detail = "Nonce mismatch - token may be replayed",
                )
            }

            MicrosoftTokenCompletion(
                origin = origin,
                generation = generation,
                success = true,
                idToken = response.idToken,
                accessToken = response.accessToken,
                refreshToken = response.refreshToken,
                email = response.email,
                name = response.name,
                scopes = grantedScopes,
                tenant = loginTenant,
                expirationTime = response.expirationTime,
            )
        } catch (error: Exception) {
            MicrosoftTokenCompletion(
                origin = origin,
                generation = generation,
                success = false,
                code = AuthErrorCode.PARSE_ERROR,
                detail = error.message,
            )
        }
    }

    internal fun commitMicrosoftTokenSuccess(completion: MicrosoftTokenCompletion): Boolean = synchronized(this) {
        if (!isCurrentMicrosoftGenerationLocked(completion.generation)) return@synchronized false
        if (completion.origin == Origin.LOGIN) {
            inMemoryMicrosoftRefreshToken = completion.refreshToken
        } else if (!completion.refreshToken.isNullOrEmpty()) {
            inMemoryMicrosoftRefreshToken = completion.refreshToken
        }
        inMemoryMicrosoftScopes = completion.scopes
        inMemoryMicrosoftTenant = completion.tenant
        googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        inMemoryOneTapSession = null
        appContext?.let { GoogleSessionStore.clearLocked(it) }
        clearPkceStateLocked()
        true
    }

    private fun restoreDurableGoogleState(context: Context) = synchronized(this) {
        googleSessionState = GoogleSessionStore.restore(context)
        googleLegacyAccountNeedsRevalidation = false
    }

    private fun clearDurableGoogleSessionStateIfCurrent(context: Context, stateEpoch: Long): Boolean = synchronized(this) {
        if (googleAuthStateEpoch != stateEpoch) return@synchronized false
        GoogleSessionStore.clearLocked(context)
        true
    }

    private fun scheduleCredentialManagerCleanup(context: Context, generation: Long, stateEpoch: Long) {
        val completion = CompletableDeferred<Unit>()
        val cleanup = GoogleCredentialCleanup(generation, stateEpoch, completion)
        val scheduled = synchronized(this) {
            if (googleAuthStateEpoch != stateEpoch || googleCredentialCleanup != null) {
                false
            } else {
                googleCredentialCleanup = cleanup
                true
            }
        }
        if (!scheduled) {
            completion.complete(Unit)
            return
        }

        moduleScope.launch {
            val run = synchronized(this@AuthAdapter) {
                val owned = googleCredentialCleanup === cleanup && googleAuthStateEpoch == stateEpoch
                if (owned) {
                    cleanup.externalCallStarted = true
                } else if (googleCredentialCleanup === cleanup) {
                    googleCredentialCleanup = null
                }
                owned
            }
            if (!run) {
                completion.complete(Unit)
                return@launch
            }
            try {
                CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
            } catch (e: Exception) {
                Log.w(TAG, "clearCredentialState failed: ${e.message}")
            } finally {
                synchronized(this@AuthAdapter) {
                    if (googleCredentialCleanup === cleanup) googleCredentialCleanup = null
                }
                completion.complete(Unit)
            }
        }
    }

    private fun getLegacyGoogleClient(context: Context): GoogleSignInClient? {
        val clientId = getClientIdFromResources(context) ?: return null
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestServerAuthCode(clientId)
            .requestEmail()
            .build()
        return GoogleSignIn.getClient(context, gso)
    }

    private fun hasLegacyGoogleAccount(context: Context): Boolean {
        val sessionKind = synchronized(this) { googleSessionState.kind }
        return isLegacyGoogleRevokeEligible(
            sessionKind = sessionKind,
            hasTrackedLegacySession = synchronized(this) {
                googleSessionState.kind == GoogleSessionKind.LEGACY && !googleLegacyAccountNeedsRevalidation
            },
            providerSdkHasAccount = getOwnedLegacyGoogleAccount(context) != null,
        )
    }

    private fun getOwnedLegacyGoogleAccount(context: Context): GoogleSignInAccount? {
        @Suppress("DEPRECATION")
        val account = GoogleSignIn.getLastSignedInAccount(context) ?: return null
        val isOwned = synchronized(this) {
            isOwnedLegacyGoogleAccount(
                sessionKind = googleSessionState.kind,
                persistedAccountId = googleSessionState.accountId,
                providerAccountId = account.id,
                needsRevalidation = googleLegacyAccountNeedsRevalidation,
            )
        }
        return if (isOwned) account else null
    }

    private fun cleanupStaleGoogleAccount(context: Context, account: GoogleSignInAccount) {
        @Suppress("DEPRECATION")
        val currentAccount = GoogleSignIn.getLastSignedInAccount(context)
        if (currentAccount?.id != account.id) return
        val accountId = account.id ?: return
        beginTargetedGoogleSignOut(context, "stale-google:$accountId", accountId)
    }

    private fun signOutUnownedGoogleAccount(context: Context) {
        @Suppress("DEPRECATION")
        val account = GoogleSignIn.getLastSignedInAccount(context) ?: return
        val accountId = account.id ?: return
        beginTargetedGoogleSignOut(context, "unowned-google:$accountId", accountId)
    }

    private fun beginTargetedGoogleSignOut(context: Context, owner: String, accountId: String) {
        val decision = synchronized(this) {
            if (!shouldCleanupStaleGooglePickerAccount(
                    needsRevalidation = googleLegacyAccountNeedsRevalidation,
                    loginPending = pendingGoogleLogin.isPending,
                    scopesPending = pendingGoogleScopes.isPending,
                    sessionKind = googleSessionState.kind,
                    hasOneTapSession = inMemoryOneTapSession != null,
                    hasMicrosoftRefreshToken = inMemoryMicrosoftRefreshToken != null,
                )
            ) {
                GooglePickerSignOutDecision.REJECT
            } else {
                googlePickerOperationState.beginTargetedSignOut(owner, accountId)
            }
        }
        if (decision == GooglePickerSignOutDecision.START) {
            startGoogleSdkSignOut(context, owner)
        }
    }

    private fun beginGoogleAuthStateTransition(clearPendingCallbacks: Boolean = false): Deferred<Unit>? {
        if (clearPendingCallbacks) clearPendingAppleAuth()
        var cancelledCleanup: CompletableDeferred<Unit>? = null
        var pickerActivityToFinish: Activity? = null
        var pickerCleanupBarrier: Deferred<Unit>? = null
        val credentialBarrier = synchronized(this) {
            advanceGoogleAuthStateLocked()
            if (clearPendingCallbacks) {
                clearPkceStateLocked()
                clearPendingCallbackGenerationsLocked()
            }
            pickerCleanupBarrier = googlePickerOperationState.cleanupBarrier()
            pickerActivityToFinish = googlePickerOperationState.invalidate() as? Activity
            val cleanup = googleCredentialCleanup
            if (cleanup != null && !cleanup.externalCallStarted) {
                googleCredentialCleanup = null
                cancelledCleanup = cleanup.completion
                null
            } else {
                cleanup?.completion
            }
        }
        pickerActivityToFinish?.let { activity ->
            activity.runOnUiThread {
                if (!activity.isFinishing && !activity.isDestroyed) {
                    activity.finish()
                }
            }
        }
        cancelledCleanup?.complete(Unit)
        return combineGoogleCleanupBarriers(credentialBarrier, pickerCleanupBarrier)
    }

    private fun combineGoogleCleanupBarriers(
        first: Deferred<Unit>?,
        second: Deferred<Unit>?,
    ): Deferred<Unit>? {
        if (first == null) return second
        if (second == null) return first
        val combined = CompletableDeferred<Unit>()
        moduleScope.launch {
            first.await()
            second.await()
            combined.complete(Unit)
        }
        return combined
    }

    internal fun advanceGoogleAuthStateLocked() {
        googleAuthStateEpoch = if (googleAuthStateEpoch == Long.MAX_VALUE) 1L else googleAuthStateEpoch + 1L
    }

    private fun rememberMicrosoftStateLocked(state: String, generation: Long) {
        rememberMicrosoftState(knownMicrosoftStates, state, generation)
    }

    internal fun beginGoogleRevoke(generation: Long) = synchronized(this) {
        googleRevokeState.begin(generation, googleAuthStateEpoch)
    }

    private fun inspectGoogleRevokeCallback(generation: Long, successful: Boolean): GoogleRevokeCallback = synchronized(this) {
        googleRevokeState.inspect(generation, googleAuthStateEpoch, successful)
    }

    private fun finishGoogleRevokeCallback(callback: GoogleRevokeCallback, nativeAccepted: Boolean): Boolean = synchronized(this) {
        if (!googleRevokeState.finish(callback)) return@synchronized false
        if (nativeAccepted && callback.decision == GoogleRevokeCallbackDecision.APPLY_SUCCESS) {
            clearPkceStateLocked()
            inMemoryOneTapSession = null
            googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        }
        true
    }

    private fun isCurrentGoogleStateEpoch(stateEpoch: Long): Boolean = synchronized(this) {
        googleAuthStateEpoch == stateEpoch
    }

    internal fun settleGoogleRevoke(
        context: Context,
        generation: Long,
        code: AuthErrorCode?,
        underlyingError: String?,
        successful: Boolean,
    ) {
        val callback = inspectGoogleRevokeCallback(generation, successful)
        if (callback.decision == GoogleRevokeCallbackDecision.IGNORE) return
        val nativeAccepted = when (callback.decision) {
            GoogleRevokeCallbackDecision.APPLY_SUCCESS ->
                nativeOnRevokeAccessResult(null, null, generation)
            GoogleRevokeCallbackDecision.SETTLE_FAILURE,
            GoogleRevokeCallbackDecision.SETTLE_ONLY ->
                nativeOnRevokeAccessResult(code?.code, underlyingError, generation)
            GoogleRevokeCallbackDecision.IGNORE -> return
        }
        if (!finishGoogleRevokeCallback(callback, nativeAccepted)) return
        if (nativeAccepted && callback.decision == GoogleRevokeCallbackDecision.APPLY_SUCCESS) {
            callback.stateEpoch?.let { stateEpoch ->
                clearDurableGoogleSessionStateIfCurrent(context, stateEpoch)
                scheduleCredentialManagerCleanup(context, callback.generation, stateEpoch)
            }
        }
    }

    private fun isCurrentGoogleGeneration(origin: Origin, generation: Long): Boolean = synchronized(this) {
        acceptsPendingGoogleGenerationLocked(origin, generation)
    }

    private fun consumeGoogleGeneration(origin: Origin, generation: Long): Boolean = synchronized(this) {
        if (!acceptsPendingGoogleGenerationLocked(origin, generation)) return@synchronized false
        clearPendingGoogleGenerationLocked(origin)
        true
    }

    private fun consumeRefreshGeneration(generation: Long): Boolean = synchronized(this) {
        val googleMatches = pendingGoogleRefresh.accepts(generation, googleAuthStateEpoch)
        val microsoftMatches = pendingMicrosoftRefresh.accepts(generation, googleAuthStateEpoch)
        if (googleMatches || microsoftMatches) {
            pendingGoogleRefresh.clear()
            pendingMicrosoftRefresh.clear()
            return@synchronized true
        }
        false
    }

    private fun clearPendingRefreshGeneration(generation: Long) = synchronized(this) {
        pendingGoogleRefresh.clearIf(generation)
        pendingMicrosoftRefresh.clearIf(generation)
    }

    private fun clearPendingSilentGeneration(generation: Long) = synchronized(this) {
        clearPendingSilentGenerationLocked(generation)
    }

    private fun isCurrentSilentGeneration(generation: Long): Boolean = synchronized(this) {
        acceptsSilentGenerationLocked(generation)
    }

    private fun acceptsSilentGenerationLocked(generation: Long): Boolean =
        pendingGoogleSilent.accepts(generation, googleAuthStateEpoch) ||
            pendingMicrosoftSilent.accepts(generation, googleAuthStateEpoch)

    private fun clearPendingSilentGenerationLocked(generation: Long) {
        pendingGoogleSilent.clearIf(generation)
        pendingMicrosoftSilent.clearIf(generation)
    }

    private fun clearPendingCallbackGenerationsLocked() {
        pendingGoogleLogin.clear()
        pendingGoogleScopes.clear()
        pendingGoogleRefresh.clear()
        pendingGoogleSilent.clear()
        googleRevokeState.clear()
        pendingMicrosoftRefresh.clear()
        pendingMicrosoftSilent.clear()
    }

    private fun clearPkceStateIfCurrent(generation: Long): Boolean = synchronized(this) {
        if (!acceptsAuthCallback(pendingMicrosoft?.generation, generation)) return@synchronized false
        clearPkceStateLocked()
        true
    }

    @Synchronized
    private fun clearPkceState() {
        clearPkceStateLocked()
    }

    private fun clearPkceStateLocked() {
        pendingMicrosoft = null
        microsoftResumeSuppressionGeneration = null
    }

    private fun pendingGoogleOperation(origin: Origin): PendingOperation? = when (origin) {
        Origin.LOGIN -> pendingGoogleLogin
        Origin.SCOPES -> pendingGoogleScopes
        else -> null
    }

    private fun acceptsPendingGoogleGenerationLocked(origin: Origin, generation: Long): Boolean =
        pendingGoogleOperation(origin)?.accepts(generation, googleAuthStateEpoch) ?: false

    private fun googlePickerStateEpochLocked(origin: Origin, generation: Long): Long? {
        if (!acceptsPendingGoogleGenerationLocked(origin, generation)) return null
        return pendingGoogleOperation(origin)?.stateEpoch
    }

    private fun clearPendingGoogleGenerationLocked(origin: Origin) {
        pendingGoogleOperation(origin)?.clear()
    }

    private fun isCurrentMicrosoftGenerationLocked(generation: Long): Boolean =
        acceptsAuthCallback(pendingMicrosoft?.generation, generation)

    /**
     * `expirationTime` is defined as the access-token expiry in epoch
     * milliseconds. Android Google never returns an OAuth access token, so
     * this documented fallback derives the expiry from the ID-token `exp`
     * claim instead. See `docs/error-contract.md`.
     */
    private fun parseGoogleIdCredential(credential: Credential): GoogleIdTokenCredential? = when {
        credential is GoogleIdTokenCredential -> credential
        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ->
            GoogleIdTokenCredential.createFrom(credential.data)
        else -> null
    }

    private fun googleUserFrom(
        account: GoogleSignInAccount,
        hostedDomain: String?,
        scopes: Array<String>?,
    ): ProviderUserFields {
        val claims = JwtClaims.decode(account.idToken.orEmpty())
        return ProviderUserFields(
            provider = AuthProvider.GOOGLE,
            email = account.email,
            name = account.displayName,
            firstName = claims["given_name"],
            lastName = claims["family_name"],
            photo = account.photoUrl?.toString(),
            idToken = account.idToken,
            serverAuthCode = account.serverAuthCode,
            userId = account.id,
            hostedDomain = hostedDomain,
            scopes = scopes,
            expirationTime = getGoogleExpirationTimeMs(account.idToken),
        )
    }

    private fun googleUserFrom(
        credential: GoogleIdTokenCredential,
        hostedDomain: String?,
        scopes: Array<String>?,
    ): ProviderUserFields {
        val claims = JwtClaims.decode(credential.idToken)
        return ProviderUserFields(
            provider = AuthProvider.GOOGLE,
            email = credential.email,
            name = credential.displayName,
            firstName = claims["given_name"],
            lastName = claims["family_name"],
            photo = credential.profilePictureUri?.toString(),
            idToken = credential.idToken,
            userId = credential.id,
            phoneNumber = credential.phoneNumber,
            hostedDomain = claims["hd"] ?: hostedDomain,
            scopes = scopes,
            expirationTime = getGoogleExpirationTimeMs(credential.idToken),
        )
    }

    private fun getGoogleExpirationTimeMs(idToken: String?): Long? {
        if (idToken.isNullOrEmpty()) return null
        val expSeconds = JwtClaims.decode(idToken)["exp"]?.toLongOrNull() ?: return null
        return epochSecondsToMillisOrNull(expSeconds)
    }

    private fun stringResource(context: Context, name: String): String? {
        val resId = context.resources.getIdentifier(name, "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    private fun getMicrosoftClientIdFromResources(context: Context): String? =
        stringResource(context, "nitro_auth_microsoft_client_id")

    private fun microsoftRedirectUri(context: Context, clientId: String): String =
        "msauth://${context.packageName}/$clientId"

    private fun microsoftTokenUrl(authBaseUrl: String): String = "${authBaseUrl}oauth2/v2.0/token"

    internal fun microsoftSessionTenant(context: Context): String =
        synchronized(this) { inMemoryMicrosoftTenant }
            ?: getMicrosoftTenantFromResources(context)
            ?: "common"

    private fun getMicrosoftTenantFromResources(context: Context): String? =
        stringResource(context, "nitro_auth_microsoft_tenant")

    private fun getMicrosoftB2cDomainFromResources(context: Context): String? =
        stringResource(context, "nitro_auth_microsoft_b2c_domain")

    private fun loginOneTap(
        context: Context,
        clientId: String,
        scopes: List<String>,
        request: LoginRequest,
        origin: Origin,
        generation: Long,
    ) {
        val nonce = request.nonce
        val hostedDomain = request.hostedDomain
        val forceAccountPicker = request.forceAccountPicker
        val activity = currentActivity ?: context as? Activity
        if (activity == null) {
            if (nonce != null) {
                Log.w(TAG, "No Activity context available for nonce-bound Credential Manager login")
                if (consumeGoogleGeneration(origin, generation)) {
                    nativeOnLoginError(origin, AuthErrorCode.CONFIGURATION_ERROR.code, "An Activity is required for nonce-bound Google credentials", generation)
                }
                return
            }
            Log.w(TAG, "No Activity context available for One-Tap, falling back to legacy")
            return loginLegacy(context, clientId, scopes, request.copy(forceCodeForRefreshToken = false), origin, generation)
        }

        val credentialManager = CredentialManager.create(activity)
        val requestBuilder = GetCredentialRequest.Builder()
        if (nonce != null && forceAccountPicker) {
            val signInOption = GetSignInWithGoogleOption.Builder(clientId)
                .apply {
                    setNonce(nonce)
                    if (hostedDomain != null) setHostedDomainFilter(hostedDomain)
                }
                .build()
            requestBuilder.addCredentialOption(signInOption)
        } else {
            val googleIdOption = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(request.filterByAuthorizedAccounts)
                .setServerClientId(clientId)
                .setAutoSelectEnabled(request.useOneTap && !forceAccountPicker)
                .setRequestVerifiedPhoneNumber(request.requestVerifiedPhoneNumber)
                .apply {
                    if (nonce != null) setNonce(nonce)
                    if (hostedDomain != null) setHostedDomainFilter(hostedDomain)
                }
                .build()
            requestBuilder.addCredentialOption(googleIdOption)
        }
        val credentialRequest = requestBuilder.build()

        moduleScope.launch(Dispatchers.Main) {
            try {
                val result = credentialManager.getCredential(context = activity, request = credentialRequest)
                handleCredentialResponse(result, scopes, hostedDomain, nonce, origin, generation)
            } catch (e: CancellationException) {
                if (consumeGoogleGeneration(origin, generation)) {
                    nativeOnLoginError(origin, AuthErrorCode.CANCELLED.code, e.message, generation)
                }
                return@launch
            } catch (e: GetCredentialCancellationException) {
                if (consumeGoogleGeneration(origin, generation)) {
                    nativeOnLoginError(origin, AuthErrorCode.CANCELLED.code, e.message, generation)
                }
            } catch (e: NoCredentialException) {
                if (nonce != null) {
                    Log.w(TAG, "Credential Manager returned no nonce-bound Google credential")
                    if (consumeGoogleGeneration(origin, generation)) {
                        nativeOnLoginError(origin, AuthErrorCode.NO_ID_TOKEN.code, e.message, generation)
                    }
                } else if (isCurrentGoogleGeneration(origin, generation)) {
                    Log.w(TAG, "One-Tap has no credentials, falling back to legacy: ${e.message}")
                    loginLegacy(context, clientId, scopes, request.copy(forceCodeForRefreshToken = false), origin, generation)
                }
            } catch (e: Exception) {
                if (nonce != null) {
                    Log.w(TAG, "Nonce-bound Credential Manager login failed (${e.javaClass.simpleName})")
                    if (consumeGoogleGeneration(origin, generation)) {
                        nativeOnLoginError(origin, AuthErrorCode.UNKNOWN.code, e.message, generation)
                    }
                } else if (isCurrentGoogleGeneration(origin, generation)) {
                    Log.w(TAG, "One-Tap failed, falling back to legacy: ${e.message}")
                    loginLegacy(context, clientId, scopes, request.copy(forceCodeForRefreshToken = false), origin, generation)
                }
            }
        }
    }

    private fun loginLegacy(
        context: Context,
        clientId: String,
        scopes: List<String>,
        request: LoginRequest,
        origin: Origin,
        generation: Long,
    ) {
        val ctx = appContext ?: context.applicationContext
        val intent = GoogleSignInActivity.createIntent(
            ctx, clientId, scopes.toTypedArray(), request.loginHint, request.forceAccountPicker,
            request.forceCodeForRefreshToken, request.hostedDomain, origin, generation,
        )
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
    }

    private fun handleCredentialResponse(
        response: GetCredentialResponse,
        scopes: List<String>,
        hostedDomain: String?,
        expectedNonce: String?,
        origin: Origin,
        generation: Long,
    ) {
        val credential = response.credential
        val googleIdTokenCredential = try {
            parseGoogleIdCredential(credential)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse Google ID token credential: ${e.message}")
            null
        }

        if (googleIdTokenCredential != null) {
            val context = appContext
            if (context == null) {
                if (consumeGoogleGeneration(origin, generation)) {
                    nativeOnLoginError(origin, AuthErrorCode.CONFIGURATION_ERROR.code, "Auth adapter is not initialized", generation)
                }
                return
            }
            if (!synchronized(this) { acceptsPendingGoogleGenerationLocked(origin, generation) }) return
            val idToken = googleIdTokenCredential.idToken
            if (expectedNonce != null) {
                if (idToken.isBlank()) {
                    if (consumeGoogleGeneration(origin, generation)) {
                        nativeOnLoginError(origin, AuthErrorCode.NO_ID_TOKEN.code, "Google returned an empty ID token", generation)
                    }
                    return
                }
                if (JwtClaims.decode(idToken)["nonce"] != expectedNonce) {
                    if (consumeGoogleGeneration(origin, generation)) {
                        nativeOnLoginError(origin, AuthErrorCode.INVALID_NONCE.code, "Nonce mismatch - token may be replayed", generation)
                    }
                    return
                }
            }
            val user = googleUserFrom(googleIdTokenCredential, hostedDomain, scopes.toTypedArray())
            if (!nativeOnLoginSuccess(origin, user, generation)) return
            val committed = synchronized(this) {
                if (!acceptsPendingGoogleGenerationLocked(origin, generation)) {
                    false
                } else {
                    clearPendingGoogleGenerationLocked(origin)
                    val session = OneTapSession(googleIdTokenCredential, scopes, hostedDomain)
                    inMemoryOneTapSession = session
                    googleSessionState = GoogleSessionState(
                        requestedHostedDomain = hostedDomain,
                        accountId = googleIdTokenCredential.id,
                        kind = GoogleSessionKind.MODERN,
                    )
                    GoogleSessionStore.persistLocked(context, googleSessionState)
                    inMemoryMicrosoftRefreshToken = null
                    inMemoryMicrosoftTenant = null
                    inMemoryMicrosoftScopes = defaultMicrosoftScopes
                    googlePickerOperationState.markSdkAccountEstablished()
                    true
                }
            }
            if (committed) getLegacyGoogleClient(context)?.signOut()
        } else {
            Log.w(TAG, "Unsupported credential type: ${credential.type}")
            if (consumeGoogleGeneration(origin, generation)) {
                val code = if (expectedNonce != null) AuthErrorCode.NO_ID_TOKEN else AuthErrorCode.UNKNOWN
                nativeOnLoginError(origin, code.code, "Unsupported credential type: ${credential.type}", generation)
            }
        }
    }

    @JvmStatic
    fun requestScopesSync(context: Context, scopes: Array<String>, generation: Long) {
        val cleanupBarrier = beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        val ctx = appContext ?: context.applicationContext
        val scopesStateEpoch = synchronized(this) {
            pendingGoogleScopes.begin(generation, googleAuthStateEpoch)
            googleAuthStateEpoch
        }
        val request = {
            if (isCurrentGoogleGeneration(Origin.SCOPES, generation) && isCurrentGoogleStateEpoch(scopesStateEpoch)) {
                requestScopesAfterTransition(ctx, scopes, generation)
            }
        }
        if (cleanupBarrier == null) {
            request()
        } else {
            moduleScope.launch(Dispatchers.Main) {
                cleanupBarrier.await()
                request()
            }
        }
    }

    private fun reportOneTapSession(
        origin: Origin,
        session: OneTapSession,
        scopes: List<String>,
        generation: Long,
    ): Boolean {
        val user = googleUserFrom(session.credential, session.hostedDomain, scopes.toTypedArray())
        return nativeOnLoginSuccess(origin, user, generation)
    }

    internal fun buildCredentialManagerRefreshRequest(clientId: String, hostedDomain: String?): GetCredentialRequest =
        GetCredentialRequest.Builder()
            .addCredentialOption(
                GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(true)
                    .setServerClientId(clientId)
                    .setAutoSelectEnabled(true)
                    .apply { hostedDomain?.let { setHostedDomainFilter(it) } }
                    .build(),
            )
            .setPreferImmediatelyAvailableCredentials(true)
            .build()

    private fun refreshCredentialManagerSession(context: Context, session: OneTapSession, generation: Long) {
        val activity = currentActivity
        val clientId = getClientIdFromResources(context)
        if (activity == null || clientId == null) {
            clearPendingRefreshGeneration(generation)
            nativeOnRefreshError(
                AuthErrorCode.REFRESH_FAILED.code,
                if (clientId == null) "Google Client ID not configured" else "A foreground Activity is required to refresh a Credential Manager session",
                generation,
            )
            return
        }
        synchronized(this) {
            pendingGoogleRefresh.begin(generation, googleAuthStateEpoch)
            pendingMicrosoftRefresh.clear()
        }
        val request = buildCredentialManagerRefreshRequest(clientId, session.hostedDomain)
        moduleScope.launch(Dispatchers.Main) {
            val refreshed = try {
                parseGoogleIdCredential(
                    CredentialManager.create(activity)
                        .getCredential(context = activity, request = request)
                        .credential,
                )
            } catch (e: CancellationException) {
                if (consumeRefreshGeneration(generation)) {
                    nativeOnRefreshError(AuthErrorCode.REFRESH_FAILED.code, e.message, generation)
                }
                return@launch
            } catch (e: Exception) {
                Log.w(TAG, "Credential Manager refresh failed (${e.javaClass.simpleName})")
                if (consumeRefreshGeneration(generation)) {
                    nativeOnRefreshError(AuthErrorCode.REFRESH_FAILED.code, e.message, generation)
                }
                return@launch
            }
            if (refreshed == null || refreshed.id != session.credential.id || refreshed.idToken.isBlank()) {
                if (consumeRefreshGeneration(generation)) {
                    nativeOnRefreshError(AuthErrorCode.REFRESH_FAILED.code, "Credential Manager returned no matching Google credential", generation)
                }
                return@launch
            }
            if (!consumeRefreshGeneration(generation)) return@launch
            synchronized(this@AuthAdapter) {
                if (inMemoryOneTapSession === session) {
                    inMemoryOneTapSession = OneTapSession(refreshed, session.scopes, session.hostedDomain)
                }
            }
            nativeOnRefreshSuccess(refreshed.idToken, null, getGoogleExpirationTimeMs(refreshed.idToken), generation)
        }
    }

    private fun requestScopesAfterTransition(context: Context, scopes: Array<String>, generation: Long) {
        val sessionKind = synchronized(this) { googleSessionState.kind }
        val microsoftSessionActive = synchronized(this) {
            sessionKind == GoogleSessionKind.NONE && inMemoryMicrosoftRefreshToken != null
        }
        @Suppress("DEPRECATION")
        val account = if (sessionKind == GoogleSessionKind.MODERN || microsoftSessionActive) {
            null
        } else {
            getOwnedLegacyGoogleAccount(context)
        }
        if (account != null) {
            val newScopes = scopes.map { Scope(it) }
            val grantedScopes = account.grantedScopes?.map { it.scopeUri }.orEmpty()
            val allScopes = (grantedScopes + scopes.toList()).distinct()
            val restoredHostedDomain = synchronized(this) {
                googleSessionState.returnedHostedDomainForAccount(account.id)
            }
            if (GoogleSignIn.hasPermissions(account, *newScopes.toTypedArray())) {
                onSignInSuccess(account, allScopes, Origin.SCOPES, restoredHostedDomain, generation)
                return
            }
            val clientId = getClientIdFromResources(context)
            if (clientId == null) {
                if (consumeGoogleGeneration(Origin.SCOPES, generation)) {
                    nativeOnLoginError(Origin.SCOPES, AuthErrorCode.CONFIGURATION_ERROR.code, "Google Client ID not configured", generation)
                }
                return
            }
            val intent = GoogleSignInActivity.createIntent(
                context,
                clientId,
                allScopes.toTypedArray(),
                account.email,
                hostedDomain = restoredHostedDomain,
                origin = Origin.SCOPES,
                generation = generation,
            )
            context.startActivity(intent)
            return
        }
        val oneTapSession = synchronized(this) { inMemoryOneTapSession }
        if (oneTapSession != null) {
            val mergedScopes = (oneTapSession.scopes + scopes.toList()).distinct()
            if (!synchronized(this) { acceptsPendingGoogleGenerationLocked(Origin.SCOPES, generation) }) return
            val credential = oneTapSession.credential
            if (!reportOneTapSession(Origin.SCOPES, oneTapSession, mergedScopes, generation)) return
            synchronized(this) {
                if (!acceptsPendingGoogleGenerationLocked(Origin.SCOPES, generation)) return@synchronized
                clearPendingGoogleGenerationLocked(Origin.SCOPES)
                inMemoryOneTapSession = OneTapSession(credential, mergedScopes, oneTapSession.hostedDomain)
            }
            return
        }
        val microsoftSession = synchronized(this) {
            inMemoryMicrosoftRefreshToken != null
        }
        if (microsoftSession) {
            synchronized(this) {
                clearPendingGoogleGenerationLocked(Origin.SCOPES)
            }
            val mergedScopes = synchronized(this) {
                (inMemoryMicrosoftScopes + scopes.toList()).distinct()
            }
            val tenant = microsoftSessionTenant(context)
            loginMicrosoft(context, mergedScopes.toTypedArray(), null, tenant, null, Origin.SCOPES, generation)
            return
        }
        if (consumeGoogleGeneration(Origin.SCOPES, generation)) {
            nativeOnLoginError(Origin.SCOPES, AuthErrorCode.NOT_SIGNED_IN.code, "No user logged in", generation)
        }
    }

    @JvmStatic
    fun refreshTokenSync(context: Context, generation: Long) {
        val ctx = appContext ?: context.applicationContext
        val sessionKind = synchronized(this) { googleSessionState.kind }
        val microsoftSessionActive = synchronized(this) {
            sessionKind == GoogleSessionKind.NONE && inMemoryMicrosoftRefreshToken != null
        }
        @Suppress("DEPRECATION")
        val account = if (sessionKind == GoogleSessionKind.MODERN || microsoftSessionActive) {
            null
        } else {
            getOwnedLegacyGoogleAccount(ctx)
        }
        if (account != null) {
            synchronized(this) {
                pendingGoogleRefresh.begin(generation, googleAuthStateEpoch)
                pendingMicrosoftRefresh.clear()
            }
            val client = getLegacyGoogleClient(ctx)
            if (client == null) {
                clearPendingRefreshGeneration(generation)
                nativeOnRefreshError(AuthErrorCode.CONFIGURATION_ERROR.code, "Google Client ID not configured", generation)
                return
            }
            client.silentSignIn().addOnCompleteListener { task ->
                if (!consumeRefreshGeneration(generation)) return@addOnCompleteListener
                if (task.isSuccessful) {
                    val acc = task.result
                    nativeOnRefreshSuccess(acc?.idToken, null, getGoogleExpirationTimeMs(acc?.idToken), generation)
                } else {
                    val exception = task.exception
                    val mappedError = (exception as? ApiException)?.let { mapGoogleStatusCode(it.statusCode) }
                        ?: AuthErrorCode.NETWORK_ERROR
                    nativeOnRefreshError(mappedError.code, exception?.message ?: "Silent sign-in failed", generation)
                }
            }
            return
        }
        val oneTapSession = synchronized(this) {
            if (googleSessionState.kind == GoogleSessionKind.MODERN) inMemoryOneTapSession else null
        }
        if (oneTapSession != null) {
            refreshCredentialManagerSession(ctx, oneTapSession, generation)
            return
        }
        val refreshToken = synchronized(this) {
            inMemoryMicrosoftRefreshToken
        }
        if (refreshToken != null) {
            synchronized(this) {
                pendingGoogleRefresh.clear()
                pendingMicrosoftRefresh.begin(generation, googleAuthStateEpoch)
            }
            refreshMicrosoftTokenForRefresh(ctx, refreshToken, generation)
            return
        }
        clearPendingRefreshGeneration(generation)
        nativeOnRefreshError(AuthErrorCode.NOT_SIGNED_IN.code, "No user logged in", generation)
    }

    @JvmStatic
    fun hasPlayServices(context: Context): Boolean {
        val ctx = appContext ?: context.applicationContext ?: return false
        return GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(ctx) == ConnectionResult.SUCCESS
    }

    @JvmStatic
    fun logoutSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        val shouldSignOutLegacy = synchronized(this) { googleSessionState.kind == GoogleSessionKind.LEGACY } ||
            GoogleSignIn.getLastSignedInAccount(ctx) != null
        synchronized(this) {
            GoogleSessionStore.clearLocked(ctx)
            googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        }
        if (shouldSignOutLegacy) {
            getLegacyGoogleClient(ctx)?.signOut()
        }
        synchronized(this) {
            googleLegacyAccountNeedsRevalidation = true
            inMemoryOneTapSession = null
            inMemoryMicrosoftRefreshToken = null
            inMemoryMicrosoftTenant = null
            inMemoryMicrosoftScopes = defaultMicrosoftScopes
        }
    }

    @JvmStatic
    fun revokeAccessSync(context: Context, provider: AuthProvider, generation: Long) {
        val ctx = appContext ?: context.applicationContext
        if (provider != AuthProvider.GOOGLE) {
            nativeOnRevokeAccessResult(
                AuthErrorCode.UNSUPPORTED_PROVIDER.code,
                "Client-side access revocation is unavailable for $provider",
                generation = generation,
            )
            return
        }
        beginGoogleRevoke(generation)
        val sessionKind = synchronized(this) { googleSessionState.kind }
        if (sessionKind == GoogleSessionKind.MODERN) {
            settleGoogleRevoke(
                context = ctx,
                generation = generation,
                code = AuthErrorCode.UNSUPPORTED_PROVIDER,
                underlyingError = "Modern Google sessions do not expose client-side access revocation",
                successful = false,
            )
            return
        }
        if (!hasLegacyGoogleAccount(ctx)) {
            settleGoogleRevoke(
                context = ctx,
                generation = generation,
                code = AuthErrorCode.NOT_SIGNED_IN,
                underlyingError = "No Google session is eligible for access revocation",
                successful = false,
            )
            return
        }
        val client = getLegacyGoogleClient(ctx)
        if (client == null) {
            settleGoogleRevoke(
                context = ctx,
                generation = generation,
                code = AuthErrorCode.CONFIGURATION_ERROR,
                underlyingError = "Google Client ID not configured",
                successful = false,
            )
            return
        }

        client.revokeAccess().addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                settleGoogleRevoke(
                    context = ctx,
                    generation = generation,
                    code = AuthErrorCode.NETWORK_ERROR,
                    underlyingError = task.exception?.message ?: "Google access revocation failed",
                    successful = false,
                )
                return@addOnCompleteListener
            }

            settleGoogleRevoke(
                context = ctx,
                generation = generation,
                code = null,
                underlyingError = null,
                successful = true,
            )
        }
    }

    private fun getClientIdFromResources(context: Context): String? =
        stringResource(context, "nitro_auth_google_client_id")

    @JvmStatic
    fun restoreSession(context: Context, generation: Long) {
        val cleanupBarrier = beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        val ctx = appContext ?: context.applicationContext ?: return
        val silentStateEpoch = synchronized(this) {
            pendingGoogleSilent.begin(generation, googleAuthStateEpoch)
            pendingMicrosoftSilent.clear()
            googleAuthStateEpoch
        }
        val restore = {
            if (isCurrentSilentGeneration(generation) && isCurrentGoogleStateEpoch(silentStateEpoch)) {
                restoreSessionAfterTransition(ctx, generation)
            }
        }
        if (cleanupBarrier == null) {
            restore()
        } else {
            moduleScope.launch(Dispatchers.Main) {
                cleanupBarrier.await()
                restore()
            }
        }
    }

    private fun restoreSessionAfterTransition(context: Context, generation: Long) {
        if (!isCurrentSilentGeneration(generation)) return
        val sessionKind = synchronized(this) { googleSessionState.kind }
        val microsoftRefreshToken = synchronized(this) { inMemoryMicrosoftRefreshToken }
        val microsoftSessionActive = sessionKind == GoogleSessionKind.NONE && microsoftRefreshToken != null
        @Suppress("DEPRECATION")
        val account = if (sessionKind == GoogleSessionKind.MODERN || microsoftSessionActive) {
            null
        } else {
            getOwnedLegacyGoogleAccount(context)
        }
        if (account != null) {
            val hostedDomain = synchronized(this) {
                googleSessionState.returnedHostedDomainForAccount(account.id)
            }
            if (!synchronized(this) { acceptsSilentGenerationLocked(generation) }) return
            val user = googleUserFrom(
                account,
                hostedDomain,
                account.grantedScopes?.map { it.scopeUri }?.toTypedArray(),
            )
            if (!nativeOnLoginSuccess(Origin.SILENT, user, generation)) return
            synchronized(this) {
                if (!acceptsSilentGenerationLocked(generation)) return@synchronized
                clearPendingSilentGenerationLocked(generation)
                googleSessionState = GoogleSessionState(
                    requestedHostedDomain = hostedDomain,
                    accountId = account.id,
                    kind = GoogleSessionKind.LEGACY,
                )
                GoogleSessionStore.persistLocked(context, googleSessionState)
            }
        } else {
            val refreshToken = microsoftRefreshToken
            if (refreshToken != null) {
                synchronized(this) {
                    pendingGoogleSilent.clear()
                    pendingMicrosoftSilent.begin(generation, googleAuthStateEpoch)
                }
                refreshMicrosoftToken(context, refreshToken, generation)
            } else {
                val oneTapSession = synchronized(this) {
                    if (sessionKind == GoogleSessionKind.MODERN) inMemoryOneTapSession else null
                }
                if (oneTapSession != null) {
                    if (!synchronized(this) { acceptsSilentGenerationLocked(generation) }) return
                    if (!reportOneTapSession(Origin.SILENT, oneTapSession, oneTapSession.scopes, generation)) return
                    synchronized(this) {
                        if (acceptsSilentGenerationLocked(generation)) clearPendingSilentGenerationLocked(generation)
                    }
                    return
                }
                if (sessionKind != GoogleSessionKind.MODERN) {
                    signOutUnownedGoogleAccount(context)
                }
                clearPendingSilentGeneration(generation)
                nativeOnLoginError(Origin.SILENT, AuthErrorCode.NOT_SIGNED_IN.code, "No session", generation)
            }
        }
    }

    private fun refreshMicrosoftToken(context: Context, refreshToken: String, generation: Long) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = microsoftSessionTenant(context)
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        val effectiveScopes = synchronized(this) {
            inMemoryMicrosoftScopes.ifEmpty { defaultMicrosoftScopes }
        }

        if (clientId == null) {
            clearPendingSilentGeneration(generation)
            nativeOnLoginError(Origin.SILENT, AuthErrorCode.CONFIGURATION_ERROR.code, "Microsoft Client ID is required for refresh", generation)
            return
        }

        val authBaseUrl = MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        if (authBaseUrl == null) {
            clearPendingSilentGeneration(generation)
            nativeOnLoginError(Origin.SILENT, AuthErrorCode.CONFIGURATION_ERROR.code, "Invalid Microsoft tenant or B2C domain", generation)
            return
        }
        val tokenUrl = microsoftTokenUrl(authBaseUrl)

        postForm(
            url = tokenUrl,
            params = linkedMapOf(
                "client_id" to clientId,
                "grant_type" to "refresh_token",
                "refresh_token" to refreshToken,
            ),
            onResult = result@{ responseCode, responseBody ->
                completeMicrosoftRefreshResponse(
                    operation = MicrosoftRefreshOperation.SILENT,
                    generation = generation,
                    responseCode = responseCode,
                    responseBody = responseBody,
                    requestedScopes = effectiveScopes,
                )?.let { completion ->
                    if (completion.success) {
                        val nativeAccepted = nativeOnLoginSuccess(
                            Origin.SILENT,
                            ProviderUserFields(
                                provider = AuthProvider.MICROSOFT,
                                email = completion.email,
                                name = completion.name,
                                idToken = completion.idToken,
                                accessToken = completion.accessToken,
                                scopes = completion.scopes.toTypedArray(),
                                expirationTime = completion.expirationTime,
                            ),
                            generation,
                        )
                        finishMicrosoftRefresh(completion, nativeAccepted)
                    } else {
                        val nativeAccepted = nativeOnLoginError(
                            Origin.SILENT,
                            completion.code.code,
                            completion.detail,
                            generation,
                        )
                        finishMicrosoftRefresh(completion, nativeAccepted)
                    }
                }
            },
            onNetworkError = { message ->
                completeMicrosoftRefreshResponse(
                    operation = MicrosoftRefreshOperation.SILENT,
                    generation = generation,
                    responseCode = null,
                    responseBody = "",
                    requestedScopes = effectiveScopes,
                    transportError = message,
                )?.let { completion ->
                    val nativeAccepted = nativeOnLoginError(
                        Origin.SILENT,
                        completion.code.code,
                        completion.detail,
                        generation,
                    )
                    finishMicrosoftRefresh(completion, nativeAccepted)
                }
            },
        )
    }

    private fun refreshMicrosoftTokenForRefresh(context: Context, refreshToken: String, generation: Long) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = microsoftSessionTenant(context)
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        val effectiveScopes = synchronized(this) {
            inMemoryMicrosoftScopes.ifEmpty { defaultMicrosoftScopes }
        }

        if (clientId == null) {
            clearPendingRefreshGeneration(generation)
            nativeOnRefreshError(AuthErrorCode.CONFIGURATION_ERROR.code, "Microsoft Client ID not configured", generation)
            return
        }

        val authBaseUrl = MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        if (authBaseUrl == null) {
            clearPendingRefreshGeneration(generation)
            nativeOnRefreshError(AuthErrorCode.CONFIGURATION_ERROR.code, "Invalid Microsoft tenant or B2C domain", generation)
            return
        }
        val tokenUrl = microsoftTokenUrl(authBaseUrl)

        postForm(
            url = tokenUrl,
            params = linkedMapOf(
                "client_id" to clientId,
                "grant_type" to "refresh_token",
                "refresh_token" to refreshToken,
            ),
            onResult = result@{ responseCode, responseBody ->
                completeMicrosoftRefreshResponse(
                    operation = MicrosoftRefreshOperation.REFRESH,
                    generation = generation,
                    responseCode = responseCode,
                    responseBody = responseBody,
                    requestedScopes = effectiveScopes,
                )?.let { completion ->
                    if (completion.success) {
                        val nativeAccepted = nativeOnRefreshSuccess(
                            completion.idToken,
                            completion.accessToken,
                            completion.expirationTime,
                            generation,
                        )
                        finishMicrosoftRefresh(completion, nativeAccepted)
                    } else {
                        val nativeAccepted = nativeOnRefreshError(
                            completion.code.code,
                            completion.detail,
                            generation,
                        )
                        finishMicrosoftRefresh(completion, nativeAccepted)
                    }
                }
            },
            onNetworkError = { message ->
                completeMicrosoftRefreshResponse(
                    operation = MicrosoftRefreshOperation.REFRESH,
                    generation = generation,
                    responseCode = null,
                    responseBody = "",
                    requestedScopes = effectiveScopes,
                    transportError = message,
                )?.let { completion ->
                    val nativeAccepted = nativeOnRefreshError(
                        completion.code.code,
                        completion.detail,
                        generation,
                    )
                    finishMicrosoftRefresh(completion, nativeAccepted)
                }
            },
        )
    }

    internal fun completeMicrosoftRefreshResponse(
        operation: MicrosoftRefreshOperation,
        generation: Long,
        responseCode: Int?,
        responseBody: String,
        requestedScopes: List<String>,
        transportError: String? = null,
    ): MicrosoftRefreshCompletion? = synchronized(this) {
        val pending = microsoftRefreshPending(operation)
        if (!pending.accepts(generation, googleAuthStateEpoch)) {
            return@synchronized null
        }
        val callbackStateEpoch = pending.stateEpoch ?: return@synchronized null

        if (transportError != null || responseCode == null) {
            return@synchronized MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = false,
                code = AuthErrorCode.NETWORK_ERROR,
                detail = transportError,
            )
        }

        if (responseCode != 200) {
            val mappedError = mapMicrosoftRefreshFailure(responseBody)
            return@synchronized MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = false,
                code = mappedError.first,
                detail = mappedError.second,
                clearRefreshToken = MicrosoftAuthConfig.shouldClearRefreshToken(responseCode),
            )
        }

        return@synchronized try {
            val response = parseMicrosoftTokenResponse(responseBody)
            MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = true,
                idToken = response.idToken,
                accessToken = response.accessToken,
                refreshToken = response.refreshToken,
                email = response.email,
                name = response.name,
                scopes = requestedScopes,
                expirationTime = response.expirationTime,
            )
        } catch (error: Exception) {
            MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = false,
                code = AuthErrorCode.PARSE_ERROR,
                detail = error.message,
            )
        }
    }

    private fun finishMicrosoftRefresh(completion: MicrosoftRefreshCompletion, nativeAccepted: Boolean) {
        if (nativeAccepted) {
            if (!commitMicrosoftRefresh(completion)) {
                discardMicrosoftRefresh(completion)
            }
        } else {
            discardMicrosoftRefresh(completion)
        }
    }

    internal fun commitMicrosoftRefresh(completion: MicrosoftRefreshCompletion): Boolean = synchronized(this) {
        val pending = microsoftRefreshPending(completion.operation)
        if (!pending.accepts(completion.generation, googleAuthStateEpoch, completion.stateEpoch)) {
            return@synchronized false
        }
        clearMicrosoftRefreshGenerationLocked(completion.operation)
        if (completion.success) {
            if (!completion.refreshToken.isNullOrEmpty()) {
                inMemoryMicrosoftRefreshToken = completion.refreshToken
            }
            inMemoryMicrosoftScopes = completion.scopes
        } else if (completion.clearRefreshToken) {
            inMemoryMicrosoftRefreshToken = null
        }
        true
    }

    private fun discardMicrosoftRefresh(completion: MicrosoftRefreshCompletion): Boolean = synchronized(this) {
        val pending = microsoftRefreshPending(completion.operation)
        if (!pending.matches(completion.generation, completion.stateEpoch)) {
            return@synchronized false
        }
        clearMicrosoftRefreshGenerationLocked(completion.operation)
        true
    }

    private fun microsoftRefreshPending(operation: MicrosoftRefreshOperation): PendingOperation = when (operation) {
        MicrosoftRefreshOperation.SILENT -> pendingMicrosoftSilent
        MicrosoftRefreshOperation.REFRESH -> pendingMicrosoftRefresh
    }

    private fun clearMicrosoftRefreshGenerationLocked(operation: MicrosoftRefreshOperation) {
        microsoftRefreshPending(operation).clear()
    }
}

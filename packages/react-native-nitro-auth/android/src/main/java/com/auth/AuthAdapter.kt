@file:Suppress("DEPRECATION")

package com.auth

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
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.Scope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.LinkedHashMap
import java.util.UUID

object AuthAdapter {
    private const val TAG = "AuthAdapter"
    private val defaultMicrosoftScopes =
        listOf("openid", "email", "profile", "offline_access", "User.Read")

    private class OneTapSession(
        val credential: GoogleIdTokenCredential,
        val scopes: List<String>,
        val hostedDomain: String?,
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
    @Volatile
    private var currentActivity: Activity? = null
    private var googleSignInClient: GoogleSignInClient? = null
    private var lifecycleCallbacks: Application.ActivityLifecycleCallbacks? = null
    private var pendingMicrosoftScopes: List<String> = emptyList()
    private val knownMicrosoftStates = LinkedHashMap<String, Long>()

    private var microsoftResumeSuppressionGeneration: Long? = null

    @Volatile
    private var pendingOrigin: String = "login"
    @Volatile
    private var pendingPkceVerifier: String? = null
    @Volatile
    private var pendingState: String? = null
    @Volatile
    private var pendingNonce: String? = null
    @Volatile
    private var pendingMicrosoftTenant: String? = null
    @Volatile
    private var pendingMicrosoftClientId: String? = null
    @Volatile
    private var pendingMicrosoftB2cDomain: String? = null
    @Volatile
    private var pendingMicrosoftGeneration: Long? = null
    @Volatile
    private var microsoftAuthInProgress = false
    @Volatile
    private var microsoftBrowserWasOpened = false
    @Volatile
    private var microsoftRedirectReceived = false
    @Volatile
    private var hasLegacyGoogleSession = false
    @Volatile
    private var googleSessionState = GoogleSessionState(null)
    @Volatile
    private var pendingGoogleLoginGeneration: Long? = null
    private var pendingGoogleLoginStateEpoch: Long? = null
    @Volatile
    private var pendingGoogleScopesGeneration: Long? = null
    private var pendingGoogleScopesStateEpoch: Long? = null
    @Volatile
    private var pendingGoogleRefreshGeneration: Long? = null
    private var pendingGoogleRefreshStateEpoch: Long? = null
    @Volatile
    private var pendingGoogleSilentGeneration: Long? = null
    private var pendingGoogleSilentStateEpoch: Long? = null
    private var googleAuthStateEpoch = 1L
    private val googlePickerOperationState = GooglePickerOperationState()
    private val googlePickerRetryHandler by lazy { Handler(Looper.getMainLooper()) }
    private var googleLegacyAccountNeedsRevalidation = false
    private val googleRevokeState = GoogleRevokeState()
    @JvmField
    internal var nativeRevokeResultSink: ((Int?, String?, Long) -> Unit)? = null
    private var googleCredentialCleanup: GoogleCredentialCleanup? = null
    @Volatile
    private var inMemoryOneTapSession: OneTapSession? = null

    @Volatile
    private var inMemoryMicrosoftRefreshToken: String? = null
    @Volatile
    private var inMemoryMicrosoftScopes: List<String> =
        defaultMicrosoftScopes
    @Volatile
    private var pendingMicrosoftRefreshGeneration: Long? = null
    private var pendingMicrosoftRefreshStateEpoch: Long? = null
    @Volatile
    private var pendingMicrosoftSilentGeneration: Long? = null
    private var pendingMicrosoftSilentStateEpoch: Long? = null

    private var moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @JvmStatic
    private external fun nativeInitialize(context: Context)
    @JvmStatic
    private external fun nativeDispose()

    @JvmStatic
    private external fun nativeOnLoginSuccess(
        origin: String,
        provider: String,
        email: String?,
        name: String?,
        photo: String?,
        idToken: String?,
        accessToken: String?,
        serverAuthCode: String?,
        userId: String?,
        phoneNumber: String?,
        hostedDomain: String?,
        scopes: Array<String>?,
        expirationTime: Long?,
        generation: Long,
    ): Boolean

    @JvmStatic
    private external fun nativeOnLoginError(origin: String, code: Int, underlyingError: String?, generation: Long): Boolean

    @JvmStatic
    private external fun nativeOnRefreshSuccess(idToken: String?, accessToken: String?, expirationTime: Long?, generation: Long): Boolean

    @JvmStatic
    private external fun nativeOnRefreshError(code: Int, underlyingError: String?, generation: Long): Boolean
    @JvmStatic
    private external fun nativeOnRevokeAccessResult(code: Int?, underlyingError: String?, generation: Long): Boolean

    @Synchronized
    fun initialize(context: Context) {
        if (isInitialized) return

        val applicationContext = context.applicationContext
        appContext = applicationContext
        restoreDurableGoogleState(applicationContext)

        val app = applicationContext as? Application
        if (app != null && lifecycleCallbacks == null) {
            lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { currentActivity = activity }
                override fun onActivityStarted(activity: Activity) { currentActivity = activity }
                override fun onActivityResumed(activity: Activity) {
                    currentActivity = activity
                    val isRedirectHandler = activity is MicrosoftAuthActivity
                    val suppressed = synchronized(this@AuthAdapter) {
                        val generation = pendingMicrosoftGeneration
                        if (shouldConsumeMicrosoftResumeSuppression(
                                resumeSuppressionGeneration = microsoftResumeSuppressionGeneration,
                                currentGeneration = generation,
                                resumingActivityIsRedirectHandler = isRedirectHandler,
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
                        val generation = pendingMicrosoftGeneration
                        if (generation == null || !shouldCancelMicrosoftAuth(
                                authInProgress = microsoftAuthInProgress,
                                browserWasOpened = microsoftBrowserWasOpened,
                                redirectReceived = microsoftRedirectReceived,
                                resumingActivityIsRedirectHandler = isRedirectHandler,
                                resumeSuppressionGeneration = microsoftResumeSuppressionGeneration,
                                currentGeneration = generation,
                        )
                        ) {
                            null
                        } else {
                            val origin = pendingOrigin
                            clearPkceStateLocked()
                            origin to generation
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
                }
                override fun onActivityPaused(activity: Activity) {
                    if (microsoftAuthInProgress) microsoftBrowserWasOpened = true
                    if (currentActivity == activity) currentActivity = null
                }
                override fun onActivityStopped(activity: Activity) { if (currentActivity == activity) currentActivity = null }
                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
                override fun onActivityDestroyed(activity: Activity) { if (currentActivity == activity) currentActivity = null }
            }
            app.registerActivityLifecycleCallbacks(lifecycleCallbacks)
        }

        try {
            nativeInitialize(applicationContext)
            isInitialized = true
        } catch (error: Throwable) {
            Log.e(TAG, "Failed to initialize NitroAuth native bridge", error)
            dispose()
            throw IllegalStateException("configuration_error", error)
        }
    }

    fun dispose() {
        beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        synchronized(this) {
            knownMicrosoftStates.clear()
            microsoftResumeSuppressionGeneration = null
        }
        moduleScope.cancel()
        moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        runCatching { nativeDispose() }
            .onFailure { Log.w(TAG, "Failed to dispose NitroAuth native bridge", it) }

        val app = appContext as? Application
        lifecycleCallbacks?.let { app?.unregisterActivityLifecycleCallbacks(it) }
        lifecycleCallbacks = null
        currentActivity = null
        appContext = null
        googleSignInClient = null
        hasLegacyGoogleSession = false
        googleLegacyAccountNeedsRevalidation = true
        googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        googleCredentialCleanup = null
        inMemoryOneTapSession = null
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftScopes = defaultMicrosoftScopes
        isInitialized = false
    }

    @JvmStatic
    fun cancelPendingOperations() {
        beginGoogleAuthStateTransition(clearPendingCallbacks = true)
    }

    @JvmStatic
    fun registerGooglePickerActivity(activity: Activity, origin: String, generation: Long): Boolean = synchronized(this) {
        val stateEpoch = googlePickerStateEpochLocked(origin, generation) ?: return@synchronized false
        if (origin == "login") {
            googleLegacyAccountNeedsRevalidation = true
        }
        googlePickerOperationState.register(activity, origin, generation, stateEpoch)
    }

    @JvmStatic
    fun claimGooglePickerLaunch(activity: Activity, origin: String, generation: Long): Boolean = synchronized(this) {
        val stateEpoch = googlePickerStateEpochLocked(origin, generation) ?: return@synchronized false
        googlePickerOperationState.claimLaunch(activity, origin, generation, stateEpoch)
    }

    @JvmStatic
    internal fun beginGooglePickerSignOut(activity: Activity, origin: String, generation: Long): GooglePickerSignOutDecision = synchronized(this) {
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
    fun unregisterGooglePickerActivity(activity: Activity, origin: String, generation: Long) {
        synchronized(this) {
            googlePickerOperationState.unregister(activity, origin, generation)
        }
    }

    @JvmStatic
    fun cleanupStaleGoogleSignInResult(context: Context, account: GoogleSignInAccount) {
        cleanupStaleGoogleAccount(context, account)
    }

    internal fun onGooglePickerSignOutChanged() {
        val activity = synchronized(this) {
            googlePickerOperationState.activeIdentity() as? GoogleSignInActivity
        } ?: return
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) {
                activity.onGooglePickerSignOutChanged()
            }
        }
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

    fun onSignInSuccess(
        account: GoogleSignInAccount,
        scopes: List<String>,
        origin: String = "login",
        hostedDomain: String? = null,
        generation: Long,
    ): Boolean {
        val context = appContext ?: return false
        if (!synchronized(this) { acceptsPendingGoogleGenerationLocked(origin, generation) }) {
            cleanupStaleGoogleAccount(context, account)
            return false
        }
        val expirationTime = getGoogleExpirationTimeMs(account.idToken)
        if (!nativeOnLoginSuccess(origin, "google", account.email, account.displayName,
            account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
            account.id, null, hostedDomain, scopes.toTypedArray(), expirationTime, generation)
        ) {
            cleanupStaleGoogleAccount(context, account)
            return false
        }
        val committed = synchronized(this) {
            if (!acceptsPendingGoogleGenerationLocked(origin, generation)) {
                false
            } else {
                clearPendingGoogleGenerationLocked(origin)
                hasLegacyGoogleSession = true
                googleLegacyAccountNeedsRevalidation = false
                googlePickerOperationState.markSdkAccountEstablished()
                googleSessionState = GoogleSessionState(
                    requestedHostedDomain = hostedDomain,
                    accountId = account.id,
                    kind = GoogleSessionKind.LEGACY,
                )
                inMemoryOneTapSession = null
                inMemoryMicrosoftRefreshToken = null
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

    fun onSignInError(errorCode: Int, message: String?, origin: String = "login", generation: Long) {
        if (!consumeGoogleGeneration(origin, generation)) return
        val mappedError = when (errorCode) {
            12501 -> AuthErrorCode.CANCELLED
            12502 -> AuthErrorCode.OPERATION_IN_PROGRESS
            4 -> AuthErrorCode.NOT_SIGNED_IN
            7 -> AuthErrorCode.NETWORK_ERROR
            8, 10 -> AuthErrorCode.CONFIGURATION_ERROR
            else -> AuthErrorCode.UNKNOWN
        }
        nativeOnLoginError(origin, mappedError.code, message, generation)
    }

    @JvmStatic
    fun loginSync(
        context: Context,
        provider: String,
        scopes: Array<String>?,
        loginHint: String?,
        nonce: String?,
        useOneTap: Boolean,
        forceAccountPicker: Boolean = false,
        useLegacyGoogleSignIn: Boolean = false,
        filterByAuthorizedAccounts: Boolean = false,
        forceCodeForRefreshToken: Boolean = false,
        requestVerifiedPhoneNumber: Boolean = false,
        tenant: String? = null,
        prompt: String? = null,
        hostedDomain: String? = null,
        openIDRealm: String? = null,
        generation: Long,
    ) {
        val cleanupBarrier = beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        if (provider == "apple") {
            nativeOnLoginError("login", AuthErrorCode.UNSUPPORTED_PROVIDER.code, "Apple Sign-In is not supported on Android.", generation)
            return
        }
        if (provider == "microsoft") {
            loginMicrosoft(context, scopes, loginHint, tenant, prompt, "login", generation)
            return
        }
        if (provider != "google") {
            nativeOnLoginError("login", AuthErrorCode.UNSUPPORTED_PROVIDER.code, "Unsupported provider: $provider", generation)
            return
        }

        val loginStateEpoch = synchronized(this) {
            pendingGoogleLoginGeneration = generation
            pendingGoogleLoginStateEpoch = googleAuthStateEpoch
            googleAuthStateEpoch
        }

        val ctx = appContext ?: context.applicationContext
        val clientId = getClientIdFromResources(ctx)
        if (clientId == null) {
            if (consumeGoogleGeneration("login", generation)) {
                nativeOnLoginError("login", AuthErrorCode.CONFIGURATION_ERROR.code, "Google Client ID is required. Set it in app.json plugins.", generation)
            }
            return
        }

        val requestedScopes = scopes?.toList() ?: listOf("email", "profile")

        val startLogin = {
            if (isCurrentGoogleGeneration("login", generation) && isCurrentGoogleStateEpoch(loginStateEpoch)) {
                if (useLegacyGoogleSignIn || forceAccountPicker) {
                    loginLegacy(context, clientId, requestedScopes, loginHint, forceAccountPicker, forceCodeForRefreshToken, hostedDomain, "login", generation)
                } else {
                    loginOneTap(context, clientId, requestedScopes, loginHint, nonce, forceAccountPicker, useOneTap, filterByAuthorizedAccounts, requestVerifiedPhoneNumber, hostedDomain, "login", generation)
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

    private fun loginMicrosoft(context: Context, scopes: Array<String>?, loginHint: String?, tenant: String?, prompt: String?, origin: String = "login", generation: Long) {
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
            if (microsoftAuthInProgress) {
                nativeOnLoginError(
                    origin,
                    AuthErrorCode.OPERATION_IN_PROGRESS.code,
                    "Microsoft authentication already in progress",
                    generation,
                )
                return
            }
            microsoftAuthInProgress = true
            microsoftBrowserWasOpened = false
            microsoftRedirectReceived = false
            microsoftResumeSuppressionGeneration = null
            pendingOrigin = origin
            pendingMicrosoftScopes = effectiveScopes
            pendingMicrosoftGeneration = generation
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
            pendingPkceVerifier = codeVerifier
            pendingState = state
            pendingNonce = nonce
            pendingMicrosoftTenant = effectiveTenant
            pendingMicrosoftClientId = clientId
            pendingMicrosoftB2cDomain = b2cDomain
            rememberMicrosoftStateLocked(state, generation)
        }
        val redirectUri = "msauth://${ctx.packageName}/${clientId}"

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
        val bytes = java.security.MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    @JvmStatic
    fun handleMicrosoftRedirect(uri: Uri) {
        val callbackState = uri.getQueryParameter("state")
        val claim = synchronized(this) {
            val currentGeneration = pendingMicrosoftGeneration
            val decision = classifyMicrosoftRedirect(
                currentState = pendingState,
                currentGeneration = currentGeneration,
                callbackState = callbackState,
                redirectReceived = microsoftRedirectReceived,
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
                    if (currentGeneration == null) {
                        null
                    } else {
                        microsoftRedirectReceived = true
                        MicrosoftRedirectClaim(
                            generation = currentGeneration,
                            origin = pendingOrigin,
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
            if (!isCurrentMicrosoftGenerationLocked(generation)) {
                null
            } else {
                val clientId = pendingMicrosoftClientId
                val tenant = pendingMicrosoftTenant
                val verifier = pendingPkceVerifier
                if (clientId == null || tenant == null || verifier == null || pendingNonce == null) {
                    null
                } else {
                    MicrosoftExchangeSnapshot(
                        origin = pendingOrigin,
                        clientId = clientId,
                        tenant = tenant,
                        b2cDomain = pendingMicrosoftB2cDomain,
                        verifier = verifier,
                        scopes = pendingMicrosoftScopes.ifEmpty { defaultMicrosoftScopes },
                    )
                }
            }
        }
        if (snapshot == null) {
            val origin = synchronized(this) {
                if (!isCurrentMicrosoftGenerationLocked(generation)) null else pendingOrigin
            }
            if (origin != null && nativeOnLoginError(origin, AuthErrorCode.INVALID_STATE.code, "Missing PKCE state for token exchange", generation)) {
                completeMicrosoftFailure(generation)
            }
            return
        }

        val redirectUri = "msauth://${ctx.packageName}/${snapshot.clientId}"
        val authBaseUrl = MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(snapshot.tenant, snapshot.b2cDomain)
        if (authBaseUrl == null) {
            if (nativeOnLoginError(snapshot.origin, AuthErrorCode.CONFIGURATION_ERROR.code, "Invalid Microsoft tenant or B2C domain", generation)) {
                completeMicrosoftFailure(generation)
            }
            return
        }
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

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
                            "microsoft",
                            completion.email,
                            completion.name,
                            null,
                            completion.idToken,
                            completion.accessToken,
                            null,
                            null,
                            null,
                            null,
                            completion.scopes.toTypedArray(),
                            completion.expirationTime,
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
            onCancelled = { message ->
                if (nativeOnLoginError(snapshot.origin, AuthErrorCode.CANCELLED.code, message, generation)) {
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
        onCancelled: (String?) -> Unit,
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
            } catch (e: CancellationException) {
                onCancelled(e.message)
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    onNetworkError(e.message)
                }
            }
        }
    }

    private fun mapMicrosoftRefreshFailure(responseCode: Int, responseBody: String): Pair<AuthErrorCode, String> {
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

    private fun completeMicrosoftTokenResponse(
        responseCode: Int,
        responseBody: String,
        generation: Long,
        requestedScopes: List<String>,
    ): MicrosoftTokenCompletion? = synchronized(this) {
        if (!isCurrentMicrosoftGenerationLocked(generation)) return@synchronized null
        val origin = pendingOrigin
        val expectedNonce = pendingNonce
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
            val json = JSONObject(responseBody)
            val idToken = json.optString("id_token")
            val accessToken = json.optString("access_token")
            val refreshToken = json.optString("refresh_token")
            val expiresIn = json.optLong("expires_in", 0)
            val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null
            if (idToken.isEmpty()) {
                return@synchronized MicrosoftTokenCompletion(
                    origin = origin,
                    generation = generation,
                    success = false,
                    code = AuthErrorCode.NO_ID_TOKEN,
                    detail = "No id_token in token response",
                )
            }

            val claims = MicrosoftAuthConfig.decodeJwt(idToken)
            if (claims["nonce"] != expectedNonce) {
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
                idToken = idToken,
                accessToken = accessToken,
                refreshToken = refreshToken,
                email = claims["preferred_username"] ?: claims["email"],
                name = claims["name"],
                scopes = grantedScopes,
                expirationTime = expirationTime,
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

    private fun commitMicrosoftTokenSuccess(completion: MicrosoftTokenCompletion): Boolean = synchronized(this) {
        if (!isCurrentMicrosoftGenerationLocked(completion.generation)) return@synchronized false
        if (completion.origin == "login") {
            inMemoryMicrosoftRefreshToken = completion.refreshToken?.ifEmpty { null }
        } else if (!completion.refreshToken.isNullOrEmpty()) {
            inMemoryMicrosoftRefreshToken = completion.refreshToken
        }
        inMemoryMicrosoftScopes = completion.scopes
        googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        hasLegacyGoogleSession = false
        inMemoryOneTapSession = null
        appContext?.let { GoogleSessionStore.clearLocked(it) }
        clearPkceStateLocked()
        true
    }

    private fun restoreDurableGoogleState(context: Context) = synchronized(this) {
        googleSessionState = GoogleSessionStore.restore(context)
        hasLegacyGoogleSession = googleSessionState.kind == GoogleSessionKind.LEGACY
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
            val decision = synchronized(this@AuthAdapter) {
                decideGoogleCredentialCleanup(
                    cleanupGeneration = googleCredentialCleanup?.generation,
                    expectedGeneration = generation,
                    cleanupStateEpoch = googleCredentialCleanup?.stateEpoch,
                    currentStateEpoch = googleAuthStateEpoch,
                    externalCallStarted = cleanup.externalCallStarted,
                )
            }
            if (decision != GoogleCredentialCleanupDecision.RUN) {
                synchronized(this@AuthAdapter) {
                    if (googleCredentialCleanup === cleanup) googleCredentialCleanup = null
                }
                completion.complete(Unit)
                return@launch
            }

            synchronized(this@AuthAdapter) {
                if (googleCredentialCleanup !== cleanup || googleAuthStateEpoch != stateEpoch) {
                    completion.complete(Unit)
                    return@launch
                }
                cleanup.externalCallStarted = true
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
                hasLegacyGoogleSession && !googleLegacyAccountNeedsRevalidation
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
        val owner = "stale-google:$accountId"
        val decision = synchronized(this) {
            if (!shouldCleanupStaleGooglePickerAccount(
                    needsRevalidation = googleLegacyAccountNeedsRevalidation,
                    loginPending = pendingGoogleLoginGeneration != null,
                    scopesPending = pendingGoogleScopesGeneration != null,
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

    private fun signOutUnownedGoogleAccount(context: Context) {
        @Suppress("DEPRECATION")
        val account = GoogleSignIn.getLastSignedInAccount(context) ?: return
        val accountId = account.id ?: return
        val owner = "unowned-google:$accountId"
        val decision = synchronized(this) {
            if (!shouldCleanupStaleGooglePickerAccount(
                    needsRevalidation = googleLegacyAccountNeedsRevalidation,
                    loginPending = pendingGoogleLoginGeneration != null,
                    scopesPending = pendingGoogleScopesGeneration != null,
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

    private fun acceptedGoogleAccountIdLocked(): String? {
        val state = googleSessionState
        return when (state.kind) {
            GoogleSessionKind.LEGACY -> {
                if (!googleLegacyAccountNeedsRevalidation) state.accountId else null
            }
            GoogleSessionKind.MODERN -> {
                inMemoryOneTapSession?.credential?.id?.takeIf { it == state.accountId }
            }
            GoogleSessionKind.NONE -> null
        }
    }

    private fun beginGoogleAuthStateTransition(clearPendingCallbacks: Boolean = false): Deferred<Unit>? {
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

    private fun advanceGoogleAuthStateLocked() {
        googleAuthStateEpoch = if (googleAuthStateEpoch == Long.MAX_VALUE) 1L else googleAuthStateEpoch + 1L
    }

    private fun rememberMicrosoftStateLocked(state: String, generation: Long) {
        rememberMicrosoftState(knownMicrosoftStates, state, generation)
    }

    private fun beginGoogleRevoke(generation: Long) = synchronized(this) {
        googleRevokeState.begin(generation, googleAuthStateEpoch)
    }

    private fun inspectGoogleRevokeCallback(generation: Long, successful: Boolean): GoogleRevokeCallback = synchronized(this) {
        googleRevokeState.inspect(generation, googleAuthStateEpoch, successful)
    }

    private fun finishGoogleRevokeCallback(callback: GoogleRevokeCallback, nativeAccepted: Boolean): Boolean = synchronized(this) {
        if (!googleRevokeState.finish(callback)) return@synchronized false
        if (nativeAccepted && callback.decision == GoogleRevokeCallbackDecision.APPLY_SUCCESS) {
            clearPkceStateLocked()
            hasLegacyGoogleSession = false
            inMemoryOneTapSession = null
            googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        }
        true
    }

    private fun isCurrentGoogleStateEpoch(stateEpoch: Long): Boolean = synchronized(this) {
        googleAuthStateEpoch == stateEpoch
    }

    private fun settleGoogleRevoke(
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
                reportNativeRevokeAccessResult(null, null, generation)
            GoogleRevokeCallbackDecision.SETTLE_FAILURE,
            GoogleRevokeCallbackDecision.SETTLE_ONLY ->
                reportNativeRevokeAccessResult(code?.code, underlyingError, generation)
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

    private fun reportNativeRevokeAccessResult(code: Int?, underlyingError: String?, generation: Long): Boolean {
        val sink = synchronized(this) { nativeRevokeResultSink }
        if (sink != null) {
            sink(code, underlyingError, generation)
            return true
        } else {
            return nativeOnRevokeAccessResult(code, underlyingError, generation)
        }
    }

    private fun isCurrentGoogleGeneration(origin: String, generation: Long): Boolean = synchronized(this) {
        acceptsPendingGoogleGenerationLocked(origin, generation)
    }

    private fun consumeGoogleGeneration(origin: String, generation: Long): Boolean = synchronized(this) {
        if (!acceptsPendingGoogleGenerationLocked(origin, generation)) return@synchronized false
        clearPendingGoogleGenerationLocked(origin)
        true
    }

    private fun consumeRefreshGeneration(generation: Long): Boolean = synchronized(this) {
        val googleMatches = acceptsPendingRefreshGenerationLocked(
            pendingGoogleRefreshGeneration,
            pendingGoogleRefreshStateEpoch,
            generation,
        )
        val microsoftMatches = acceptsPendingRefreshGenerationLocked(
            pendingMicrosoftRefreshGeneration,
            pendingMicrosoftRefreshStateEpoch,
            generation,
        )
        if (googleMatches || microsoftMatches) {
            pendingGoogleRefreshGeneration = null
            pendingGoogleRefreshStateEpoch = null
            pendingMicrosoftRefreshGeneration = null
            pendingMicrosoftRefreshStateEpoch = null
            return@synchronized true
        }
        false
    }

    private fun clearPendingRefreshGeneration(generation: Long) = synchronized(this) {
        if (pendingGoogleRefreshGeneration == generation) {
            pendingGoogleRefreshGeneration = null
            pendingGoogleRefreshStateEpoch = null
        }
        if (pendingMicrosoftRefreshGeneration == generation) {
            pendingMicrosoftRefreshGeneration = null
            pendingMicrosoftRefreshStateEpoch = null
        }
    }

    private fun consumeSilentGeneration(generation: Long): Boolean = synchronized(this) {
        val googleMatches = acceptsPendingRefreshGenerationLocked(
            pendingGoogleSilentGeneration,
            pendingGoogleSilentStateEpoch,
            generation,
        )
        val microsoftMatches = acceptsPendingRefreshGenerationLocked(
            pendingMicrosoftSilentGeneration,
            pendingMicrosoftSilentStateEpoch,
            generation,
        )
        if (googleMatches || microsoftMatches) {
            pendingGoogleSilentGeneration = null
            pendingGoogleSilentStateEpoch = null
            pendingMicrosoftSilentGeneration = null
            pendingMicrosoftSilentStateEpoch = null
            return@synchronized true
        }
        false
    }

    private fun clearPendingSilentGeneration(generation: Long) = synchronized(this) {
        if (pendingGoogleSilentGeneration == generation) {
            pendingGoogleSilentGeneration = null
            pendingGoogleSilentStateEpoch = null
        }
        if (pendingMicrosoftSilentGeneration == generation) {
            pendingMicrosoftSilentGeneration = null
            pendingMicrosoftSilentStateEpoch = null
        }
    }

    private fun isCurrentSilentGeneration(generation: Long): Boolean = synchronized(this) {
        acceptsSilentGenerationLocked(generation)
    }

    private fun acceptsSilentGenerationLocked(generation: Long): Boolean =
        acceptsAuthStateCallback(
            pendingGoogleSilentGeneration,
            generation,
            pendingGoogleSilentStateEpoch,
            pendingGoogleSilentStateEpoch,
            googleAuthStateEpoch,
        ) || acceptsAuthStateCallback(
            pendingMicrosoftSilentGeneration,
            generation,
            pendingMicrosoftSilentStateEpoch,
            pendingMicrosoftSilentStateEpoch,
            googleAuthStateEpoch,
        )

    private fun clearPendingSilentGenerationLocked(generation: Long) {
        if (pendingGoogleSilentGeneration == generation) {
            pendingGoogleSilentGeneration = null
            pendingGoogleSilentStateEpoch = null
        }
        if (pendingMicrosoftSilentGeneration == generation) {
            pendingMicrosoftSilentGeneration = null
            pendingMicrosoftSilentStateEpoch = null
        }
    }

    private fun clearPendingCallbackGenerationsLocked() {
        pendingGoogleLoginGeneration = null
        pendingGoogleLoginStateEpoch = null
        pendingGoogleScopesGeneration = null
        pendingGoogleScopesStateEpoch = null
        pendingGoogleRefreshGeneration = null
        pendingGoogleRefreshStateEpoch = null
        pendingGoogleSilentGeneration = null
        pendingGoogleSilentStateEpoch = null
        googleRevokeState.clear()
        pendingMicrosoftRefreshGeneration = null
        pendingMicrosoftRefreshStateEpoch = null
        pendingMicrosoftSilentGeneration = null
        pendingMicrosoftSilentStateEpoch = null
    }

    private fun isCurrentMicrosoftGeneration(generation: Long): Boolean = synchronized(this) {
        isCurrentMicrosoftGenerationLocked(generation)
    }

    private fun clearPkceStateIfCurrent(generation: Long): Boolean = synchronized(this) {
        if (!acceptsAuthCallback(pendingMicrosoftGeneration, generation)) return@synchronized false
        clearPkceStateLocked()
        true
    }

    @Synchronized
    private fun clearPkceState() {
        clearPkceStateLocked()
    }

    private fun clearPkceStateLocked() {
        pendingOrigin = "login"
        pendingPkceVerifier = null
        pendingState = null
        pendingNonce = null
        pendingMicrosoftTenant = null
        pendingMicrosoftClientId = null
        pendingMicrosoftB2cDomain = null
        pendingMicrosoftGeneration = null
        pendingMicrosoftScopes = emptyList()
        microsoftAuthInProgress = false
        microsoftBrowserWasOpened = false
        microsoftRedirectReceived = false
        microsoftResumeSuppressionGeneration = null
    }

    private fun acceptsPendingGoogleGenerationLocked(origin: String, generation: Long): Boolean {
        val activeGeneration: Long?
        val activeEpoch: Long?
        when (origin) {
            "login" -> {
                activeGeneration = pendingGoogleLoginGeneration
                activeEpoch = pendingGoogleLoginStateEpoch
            }
            "scopes" -> {
                activeGeneration = pendingGoogleScopesGeneration
                activeEpoch = pendingGoogleScopesStateEpoch
            }
            else -> return false
        }
        return acceptsAuthStateCallback(
            activeGeneration,
            generation,
            activeEpoch,
            activeEpoch,
            googleAuthStateEpoch,
        )
    }

    private fun googlePickerStateEpochLocked(origin: String, generation: Long): Long? {
        if (!acceptsPendingGoogleGenerationLocked(origin, generation)) return null
        return when (origin) {
            "login" -> pendingGoogleLoginStateEpoch
            "scopes" -> pendingGoogleScopesStateEpoch
            else -> null
        }
    }

    private fun clearPendingGoogleGenerationLocked(origin: String) {
        when (origin) {
            "login" -> {
                pendingGoogleLoginGeneration = null
                pendingGoogleLoginStateEpoch = null
            }
            "scopes" -> {
                pendingGoogleScopesGeneration = null
                pendingGoogleScopesStateEpoch = null
            }
        }
    }

    private fun acceptsPendingRefreshGenerationLocked(
        activeGeneration: Long?,
        activeStateEpoch: Long?,
        callbackGeneration: Long,
    ): Boolean = acceptsAuthStateCallback(
        activeGeneration,
        callbackGeneration,
        activeStateEpoch,
        activeStateEpoch,
        googleAuthStateEpoch,
    )

    private fun isCurrentMicrosoftGenerationLocked(generation: Long): Boolean =
        acceptsAuthCallback(pendingMicrosoftGeneration, generation)

    /**
     * `expirationTime` is defined as the access-token expiry in epoch
     * milliseconds. Android Google never returns an OAuth access token, so
     * this documented fallback derives the expiry from the ID-token `exp`
     * claim instead. See `docs/error-contract.md`.
     */
    private fun getGoogleExpirationTimeMs(idToken: String?): Long? {
        if (idToken.isNullOrEmpty()) return null
        val expSeconds = MicrosoftAuthConfig.decodeJwt(idToken)["exp"]?.toLongOrNull() ?: return null
        return expSeconds * 1000
    }

    private fun getMicrosoftClientIdFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_microsoft_client_id", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    private fun getMicrosoftTenantFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_microsoft_tenant", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    private fun getMicrosoftB2cDomainFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_microsoft_b2c_domain", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    private fun loginOneTap(
        context: Context,
        clientId: String,
        scopes: List<String>,
        loginHint: String?,
        nonce: String?,
        forceAccountPicker: Boolean,
        useOneTap: Boolean,
        filterByAuthorizedAccounts: Boolean,
        requestVerifiedPhoneNumber: Boolean,
        hostedDomain: String?,
        origin: String = "login",
        generation: Long,
    ) {
        val activity = currentActivity ?: context as? Activity
        if (activity == null) {
            Log.w(TAG, "No Activity context available for One-Tap, falling back to legacy")
            return loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, false, hostedDomain, origin, generation)
        }

        val credentialManager = CredentialManager.create(activity)
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(filterByAuthorizedAccounts)
            .setServerClientId(clientId)
            .setAutoSelectEnabled(useOneTap && !forceAccountPicker)
            .setRequestVerifiedPhoneNumber(requestVerifiedPhoneNumber)
            .apply {
                if (nonce != null) setNonce(nonce)
                if (hostedDomain != null) setHostedDomainFilter(hostedDomain)
            }
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        moduleScope.launch(Dispatchers.Main) {
            try {
                val result = credentialManager.getCredential(context = activity, request = request)
                handleCredentialResponse(result, scopes, hostedDomain, origin, generation)
            } catch (e: CancellationException) {
                return@launch
            } catch (e: GetCredentialCancellationException) {
                if (consumeGoogleGeneration(origin, generation)) {
                    nativeOnLoginError(origin, AuthErrorCode.CANCELLED.code, e.message, generation)
                }
            } catch (e: NoCredentialException) {
                Log.w(TAG, "One-Tap has no credentials, falling back to legacy: ${e.message}")
                if (isCurrentGoogleGeneration(origin, generation)) {
                    loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, false, hostedDomain, origin, generation)
                }
            } catch (e: Exception) {
                Log.w(TAG, "One-Tap failed, falling back to legacy: ${e.message}")
                if (isCurrentGoogleGeneration(origin, generation)) {
                    loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, false, hostedDomain, origin, generation)
                }
            }
        }
    }

    private fun loginLegacy(
        context: Context,
        clientId: String,
        scopes: List<String>,
        loginHint: String?,
        forceAccountPicker: Boolean,
        forceCodeForRefreshToken: Boolean,
        hostedDomain: String?,
        origin: String = "login",
        generation: Long,
    ) {
        val ctx = appContext ?: context.applicationContext
        val intent = GoogleSignInActivity.createIntent(
            ctx, clientId, scopes.toTypedArray(), loginHint, forceAccountPicker, forceCodeForRefreshToken, hostedDomain, origin, generation
        )
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
    }

    private fun handleCredentialResponse(
        response: GetCredentialResponse,
        scopes: List<String>,
        hostedDomain: String?,
        origin: String,
        generation: Long,
    ) {
        val credential = response.credential
        val googleIdTokenCredential = try {
            if (credential is GoogleIdTokenCredential) {
                credential
            } else if (credential.type == "com.google.android.libraries.identity.googleid.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL") {
                GoogleIdTokenCredential.createFrom(credential.data)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse Google ID token credential: ${e.message}")
            null
        }

        if (googleIdTokenCredential != null) {
            val context = appContext ?: return
            if (!synchronized(this) { acceptsPendingGoogleGenerationLocked(origin, generation) }) return
            val expirationTime = getGoogleExpirationTimeMs(googleIdTokenCredential.idToken)
            if (!nativeOnLoginSuccess(
                origin, "google",
                googleIdTokenCredential.email,
                googleIdTokenCredential.displayName,
                googleIdTokenCredential.profilePictureUri?.toString(),
                googleIdTokenCredential.idToken,
                null, null,
                googleIdTokenCredential.id,
                googleIdTokenCredential.phoneNumber,
                hostedDomain,
                scopes.toTypedArray(),
                expirationTime,
                generation,
            )) return
            val committed = synchronized(this) {
                if (!acceptsPendingGoogleGenerationLocked(origin, generation)) {
                    false
                } else {
                    clearPendingGoogleGenerationLocked(origin)
                    val session = OneTapSession(googleIdTokenCredential, scopes, hostedDomain)
                    inMemoryOneTapSession = session
                    hasLegacyGoogleSession = false
                    googleSessionState = GoogleSessionState(
                        requestedHostedDomain = hostedDomain,
                        accountId = googleIdTokenCredential.id,
                        kind = GoogleSessionKind.MODERN,
                    )
                    GoogleSessionStore.persistLocked(context, googleSessionState)
                    inMemoryMicrosoftRefreshToken = null
                    inMemoryMicrosoftScopes = defaultMicrosoftScopes
                    googlePickerOperationState.markSdkAccountEstablished()
                    true
                }
            }
            if (committed) getLegacyGoogleClient(context)?.signOut()
        } else {
            Log.w(TAG, "Unsupported credential type: ${credential.type}")
            if (consumeGoogleGeneration(origin, generation)) {
                nativeOnLoginError(origin, AuthErrorCode.UNKNOWN.code, "Unsupported credential type: ${credential.type}", generation)
            }
        }
    }

    @JvmStatic
    fun requestScopesSync(context: Context, scopes: Array<String>, generation: Long) {
        val cleanupBarrier = beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        val ctx = appContext ?: context.applicationContext
        val scopesStateEpoch = synchronized(this) {
            pendingGoogleScopesGeneration = generation
            pendingGoogleScopesStateEpoch = googleAuthStateEpoch
            googleAuthStateEpoch
        }
        val request = {
            if (isCurrentGoogleGeneration("scopes", generation) && isCurrentGoogleStateEpoch(scopesStateEpoch)) {
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
                onSignInSuccess(account, allScopes, "scopes", restoredHostedDomain, generation)
                return
            }
            val clientId = getClientIdFromResources(context)
            if (clientId == null) {
                if (consumeGoogleGeneration("scopes", generation)) {
                    nativeOnLoginError("scopes", AuthErrorCode.CONFIGURATION_ERROR.code, "Google Client ID not configured", generation)
                }
                return
            }
            val intent = GoogleSignInActivity.createIntent(
                context,
                clientId,
                allScopes.toTypedArray(),
                account.email,
                hostedDomain = restoredHostedDomain,
                origin = "scopes",
                generation = generation,
            )
            context.startActivity(intent)
            return
        }
        val oneTapSession = synchronized(this) { inMemoryOneTapSession }
        if (oneTapSession != null) {
            val mergedScopes = (oneTapSession.scopes + scopes.toList()).distinct()
            if (!synchronized(this) { acceptsPendingGoogleGenerationLocked("scopes", generation) }) return
            val credential = oneTapSession.credential
            if (!nativeOnLoginSuccess(
                "scopes", "google",
                credential.email,
                credential.displayName,
                credential.profilePictureUri?.toString(),
                credential.idToken,
                null, null,
                credential.id,
                credential.phoneNumber,
                oneTapSession.hostedDomain,
                mergedScopes.toTypedArray(),
                getGoogleExpirationTimeMs(credential.idToken),
                generation,
            )) return
            synchronized(this) {
                if (!acceptsPendingGoogleGenerationLocked("scopes", generation)) return@synchronized
                clearPendingGoogleGenerationLocked("scopes")
                inMemoryOneTapSession = OneTapSession(credential, mergedScopes, oneTapSession.hostedDomain)
            }
            return
        }
        val microsoftSession = synchronized(this) {
            inMemoryMicrosoftRefreshToken != null
        }
        if (microsoftSession) {
            synchronized(this) {
                clearPendingGoogleGenerationLocked("scopes")
            }
            val mergedScopes = synchronized(this) {
                (inMemoryMicrosoftScopes + scopes.toList()).distinct()
            }
            val tenant = getMicrosoftTenantFromResources(context)
            loginMicrosoft(context, mergedScopes.toTypedArray(), null, tenant, null, "scopes", generation)
            return
        }
        if (consumeGoogleGeneration("scopes", generation)) {
            nativeOnLoginError("scopes", AuthErrorCode.NOT_SIGNED_IN.code, "No user logged in", generation)
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
                pendingGoogleRefreshGeneration = generation
                pendingGoogleRefreshStateEpoch = googleAuthStateEpoch
                pendingMicrosoftRefreshGeneration = null
                pendingMicrosoftRefreshStateEpoch = null
            }
            val client = googleSignInClient ?: run {
                val clientId = getClientIdFromResources(ctx)
                if (clientId == null) {
                    clearPendingRefreshGeneration(generation)
                    nativeOnRefreshError(AuthErrorCode.CONFIGURATION_ERROR.code, "Google Client ID not configured", generation)
                    return
                }
                val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestIdToken(clientId)
                    .requestServerAuthCode(clientId)
                    .requestEmail()
                    .build()
                GoogleSignIn.getClient(ctx, gso).also {
                    googleSignInClient = it
                }
            }
            client.silentSignIn().addOnCompleteListener { task ->
                if (!consumeRefreshGeneration(generation)) return@addOnCompleteListener
                if (task.isSuccessful) {
                    val acc = task.result
                    nativeOnRefreshSuccess(acc?.idToken, null, getGoogleExpirationTimeMs(acc?.idToken), generation)
                } else {
                    nativeOnRefreshError(AuthErrorCode.NETWORK_ERROR.code, task.exception?.message ?: "Silent sign-in failed", generation)
                }
            }
            return
        }
        val refreshToken = synchronized(this) {
            inMemoryMicrosoftRefreshToken
        }
        if (refreshToken != null) {
            synchronized(this) {
                pendingGoogleRefreshGeneration = null
                pendingGoogleRefreshStateEpoch = null
                pendingMicrosoftRefreshGeneration = generation
                pendingMicrosoftRefreshStateEpoch = googleAuthStateEpoch
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
        val shouldSignOutLegacy = synchronized(this) { hasLegacyGoogleSession } ||
            GoogleSignIn.getLastSignedInAccount(ctx) != null
        synchronized(this) {
            GoogleSessionStore.clearLocked(ctx)
            googleSessionState = GoogleSessionState(null, kind = GoogleSessionKind.NONE)
        }
        if (shouldSignOutLegacy) {
            getLegacyGoogleClient(ctx)?.signOut()
        }
        synchronized(this) {
            hasLegacyGoogleSession = false
            googleLegacyAccountNeedsRevalidation = true
            inMemoryOneTapSession = null
            inMemoryMicrosoftRefreshToken = null
            inMemoryMicrosoftScopes = defaultMicrosoftScopes
        }
    }

    @JvmStatic
    fun revokeAccessSync(context: Context, provider: String, generation: Long) {
        val ctx = appContext ?: context.applicationContext
        if (provider != "google") {
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

    private fun getClientIdFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_google_client_id", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    @JvmStatic
    fun restoreSession(context: Context, generation: Long) {
        val cleanupBarrier = beginGoogleAuthStateTransition(clearPendingCallbacks = true)
        val ctx = appContext ?: context.applicationContext ?: return
        val silentStateEpoch = synchronized(this) {
            pendingGoogleSilentGeneration = generation
            pendingGoogleSilentStateEpoch = googleAuthStateEpoch
            pendingMicrosoftSilentGeneration = null
            pendingMicrosoftSilentStateEpoch = null
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
            val expirationTime = getGoogleExpirationTimeMs(account.idToken)
            if (!nativeOnLoginSuccess("silent", "google", account.email, account.displayName,
                account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
                account.id, null, hostedDomain, account.grantedScopes?.map { it.scopeUri }?.toTypedArray(), expirationTime, generation)
            ) return
            synchronized(this) {
                if (!acceptsSilentGenerationLocked(generation)) return@synchronized
                clearPendingSilentGenerationLocked(generation)
                hasLegacyGoogleSession = true
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
                    pendingGoogleSilentGeneration = null
                    pendingGoogleSilentStateEpoch = null
                    pendingMicrosoftSilentGeneration = generation
                    pendingMicrosoftSilentStateEpoch = googleAuthStateEpoch
                }
                refreshMicrosoftToken(context, refreshToken, generation)
            } else {
                if (sessionKind != GoogleSessionKind.MODERN) {
                    signOutUnownedGoogleAccount(context)
                }
                clearPendingSilentGeneration(generation)
                nativeOnLoginError("silent", AuthErrorCode.NOT_SIGNED_IN.code, "No session", generation)
            }
        }
    }

    private fun refreshMicrosoftToken(context: Context, refreshToken: String, generation: Long) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = getMicrosoftTenantFromResources(context) ?: "common"
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        val effectiveScopes = synchronized(this) {
            inMemoryMicrosoftScopes.ifEmpty { defaultMicrosoftScopes }
        }

        if (clientId == null) {
            clearPendingSilentGeneration(generation)
            nativeOnLoginError("silent", AuthErrorCode.CONFIGURATION_ERROR.code, "Microsoft Client ID is required for refresh", generation)
            return
        }

        val authBaseUrl = MicrosoftAuthConfig.getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        if (authBaseUrl == null) {
            clearPendingSilentGeneration(generation)
            nativeOnLoginError("silent", AuthErrorCode.CONFIGURATION_ERROR.code, "Invalid Microsoft tenant or B2C domain", generation)
            return
        }
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

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
                            "silent",
                            "microsoft",
                            completion.email,
                            completion.name,
                            null,
                            completion.idToken,
                            completion.accessToken,
                            null,
                            null,
                            null,
                            null,
                            completion.scopes.toTypedArray(),
                            completion.expirationTime,
                            generation,
                        )
                        finishMicrosoftRefresh(completion, nativeAccepted)
                    } else {
                        val nativeAccepted = nativeOnLoginError(
                            "silent",
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
                        "silent",
                        completion.code.code,
                        completion.detail,
                        generation,
                    )
                    finishMicrosoftRefresh(completion, nativeAccepted)
                }
            },
            onCancelled = { message ->
                completeMicrosoftRefreshResponse(
                    operation = MicrosoftRefreshOperation.SILENT,
                    generation = generation,
                    responseCode = null,
                    responseBody = "",
                    requestedScopes = effectiveScopes,
                    transportError = message,
                    cancelled = true,
                )?.let { completion ->
                    val nativeAccepted = nativeOnLoginError(
                        "silent",
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
        val tenant = getMicrosoftTenantFromResources(context) ?: "common"
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
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

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
            onCancelled = { message ->
                completeMicrosoftRefreshResponse(
                    operation = MicrosoftRefreshOperation.REFRESH,
                    generation = generation,
                    responseCode = null,
                    responseBody = "",
                    requestedScopes = effectiveScopes,
                    transportError = message,
                    cancelled = true,
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

    private fun completeMicrosoftRefreshResponse(
        operation: MicrosoftRefreshOperation,
        generation: Long,
        responseCode: Int?,
        responseBody: String,
        requestedScopes: List<String>,
        transportError: String? = null,
        cancelled: Boolean = false,
    ): MicrosoftRefreshCompletion? = synchronized(this) {
        val activeGeneration: Long?
        val activeStateEpoch: Long?
        when (operation) {
            MicrosoftRefreshOperation.SILENT -> {
                activeGeneration = pendingMicrosoftSilentGeneration
                activeStateEpoch = pendingMicrosoftSilentStateEpoch
            }
            MicrosoftRefreshOperation.REFRESH -> {
                activeGeneration = pendingMicrosoftRefreshGeneration
                activeStateEpoch = pendingMicrosoftRefreshStateEpoch
            }
        }
        if (!acceptsAuthStateCallback(
                activeGeneration,
                generation,
                activeStateEpoch,
                activeStateEpoch,
                googleAuthStateEpoch,
            )
        ) {
            return@synchronized null
        }
        val callbackStateEpoch = activeStateEpoch ?: return@synchronized null

        if (transportError != null || responseCode == null) {
            return@synchronized MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = false,
                code = if (cancelled) AuthErrorCode.CANCELLED else AuthErrorCode.NETWORK_ERROR,
                detail = transportError,
            )
        }

        if (responseCode != 200) {
            val mappedError = mapMicrosoftRefreshFailure(responseCode, responseBody)
            return@synchronized MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = false,
                code = mappedError.first,
                detail = mappedError.second,
                clearRefreshToken = responseCode in 400..499,
            )
        }

        return@synchronized try {
            val json = JSONObject(responseBody)
            val idToken = json.optString("id_token")
            val accessToken = json.optString("access_token")
            val newRefreshToken = json.optString("refresh_token")
            val expiresIn = json.optLong("expires_in", 0)
            val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null
            val claims = MicrosoftAuthConfig.decodeJwt(idToken)
            MicrosoftRefreshCompletion(
                operation = operation,
                generation = generation,
                stateEpoch = callbackStateEpoch,
                success = true,
                idToken = idToken.ifEmpty { null },
                accessToken = accessToken.ifEmpty { null },
                refreshToken = newRefreshToken.ifEmpty { null },
                email = claims["preferred_username"] ?: claims["email"],
                name = claims["name"],
                scopes = requestedScopes,
                expirationTime = expirationTime,
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

    private fun commitMicrosoftRefresh(completion: MicrosoftRefreshCompletion): Boolean = synchronized(this) {
        val activeGeneration: Long?
        val activeStateEpoch: Long?
        when (completion.operation) {
            MicrosoftRefreshOperation.SILENT -> {
                activeGeneration = pendingMicrosoftSilentGeneration
                activeStateEpoch = pendingMicrosoftSilentStateEpoch
            }
            MicrosoftRefreshOperation.REFRESH -> {
                activeGeneration = pendingMicrosoftRefreshGeneration
                activeStateEpoch = pendingMicrosoftRefreshStateEpoch
            }
        }
        if (!acceptsAuthStateCallback(
                activeGeneration,
                completion.generation,
                activeStateEpoch,
                completion.stateEpoch,
                googleAuthStateEpoch,
            )
        ) {
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
        val activeGeneration: Long?
        val activeStateEpoch: Long?
        when (completion.operation) {
            MicrosoftRefreshOperation.SILENT -> {
                activeGeneration = pendingMicrosoftSilentGeneration
                activeStateEpoch = pendingMicrosoftSilentStateEpoch
            }
            MicrosoftRefreshOperation.REFRESH -> {
                activeGeneration = pendingMicrosoftRefreshGeneration
                activeStateEpoch = pendingMicrosoftRefreshStateEpoch
            }
        }
        if (activeGeneration != completion.generation || activeStateEpoch != completion.stateEpoch) {
            return@synchronized false
        }
        clearMicrosoftRefreshGenerationLocked(completion.operation)
        true
    }

    private fun clearMicrosoftRefreshGenerationLocked(operation: MicrosoftRefreshOperation) {
        when (operation) {
            MicrosoftRefreshOperation.SILENT -> {
                pendingMicrosoftSilentGeneration = null
                pendingMicrosoftSilentStateEpoch = null
            }
            MicrosoftRefreshOperation.REFRESH -> {
                pendingMicrosoftRefreshGeneration = null
                pendingMicrosoftRefreshStateEpoch = null
            }
        }
    }
}

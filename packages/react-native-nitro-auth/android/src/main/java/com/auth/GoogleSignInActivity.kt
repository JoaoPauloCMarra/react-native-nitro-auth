@file:Suppress("DEPRECATION")

package com.auth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

class GoogleSignInActivity : ComponentActivity() {
    companion object {
        private const val TAG = "GoogleSignInActivity"
        private const val EXTRA_CLIENT_ID = "client_id"
        private const val EXTRA_SCOPES = "scopes"
        private const val EXTRA_LOGIN_HINT = "login_hint"
        private const val EXTRA_FORCE_PICKER = "force_picker"
        private const val EXTRA_FORCE_CODE_FOR_REFRESH_TOKEN = "force_code_for_refresh_token"
        private const val EXTRA_HOSTED_DOMAIN = "hosted_domain"
        private const val EXTRA_ORIGIN = "origin"
        private const val EXTRA_GENERATION = "generation"
        private const val STATE_RESULT_DELIVERED = "result_delivered"
        private const val STATE_LAUNCH_STARTED = "launch_started"
        private const val STATE_LAUNCH_TOKEN = "launch_token"
        private const val STATE_SIGN_OUT_IN_PROGRESS = "sign_out_in_progress"
        private const val STATE_LAUNCH_DEFERRED = "launch_deferred"

        fun createIntent(context: Context, clientId: String, scopes: Array<String>, loginHint: String?, forcePicker: Boolean = false, forceCodeForRefreshToken: Boolean = false, hostedDomain: String? = null, origin: String = "login", generation: Long = 0L): Intent {
            return Intent(context, GoogleSignInActivity::class.java).apply {
                putExtra(EXTRA_CLIENT_ID, clientId)
                putExtra(EXTRA_SCOPES, scopes)
                putExtra(EXTRA_LOGIN_HINT, loginHint)
                putExtra(EXTRA_FORCE_PICKER, forcePicker)
                putExtra(EXTRA_FORCE_CODE_FOR_REFRESH_TOKEN, forceCodeForRefreshToken)
                putExtra(EXTRA_HOSTED_DOMAIN, hostedDomain)
                putExtra(EXTRA_ORIGIN, origin)
                putExtra(EXTRA_GENERATION, generation)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
    }
    
    private val signInLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (resultDelivered) return@registerForActivityResult
        resultDelivered = true
        val origin = intent.getStringExtra(EXTRA_ORIGIN) ?: "login"
        val generation = intent.getLongExtra(EXTRA_GENERATION, 0L)
        try {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            val account = task.getResult(ApiException::class.java)
            val scopes = intent.getStringArrayExtra(EXTRA_SCOPES)?.toList() ?: emptyList()
            val accepted = AuthAdapter.onSignInSuccess(
                account,
                scopes,
                origin,
                intent.getStringExtra(EXTRA_HOSTED_DOMAIN),
                generation,
            )
            if (!accepted) {
                AuthAdapter.cleanupStaleGoogleSignInResult(this, account)
            }
        } catch (e: ApiException) {
            AuthAdapter.onSignInError(e.statusCode, e.message, origin, generation)
        }
        finish()
    }

    private var resultDelivered = false
    private var launchStarted = false
    private var lifecycleStateSaved = false
    private var launchToken = 1L
    private var signOutInProgress = false
    private var launchDeferred = false
    private var signInClient: GoogleSignInClient? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        resultDelivered = savedInstanceState?.getBoolean(STATE_RESULT_DELIVERED) ?: false
        launchStarted = savedInstanceState?.getBoolean(STATE_LAUNCH_STARTED) ?: false
        launchToken = savedInstanceState?.getLong(STATE_LAUNCH_TOKEN, 1L) ?: 1L
        signOutInProgress = savedInstanceState?.getBoolean(STATE_SIGN_OUT_IN_PROGRESS) ?: false
        launchDeferred = savedInstanceState?.getBoolean(STATE_LAUNCH_DEFERRED) ?: false
        val origin = intent.getStringExtra(EXTRA_ORIGIN) ?: "login"
        val generation = intent.getLongExtra(EXTRA_GENERATION, 0L)
        if (!resultDelivered && !AuthAdapter.registerGooglePickerActivity(this, origin, generation)) {
            resultDelivered = true
            finish()
            return
        }
        when (decideGoogleSignInActivity(savedInstanceState != null, resultDelivered, launchStarted)) {
            GoogleSignInActivityDecision.FINISH -> {
                finish()
                return
            }
            GoogleSignInActivityDecision.WAIT_FOR_RESULT -> {
                return
            }
            GoogleSignInActivityDecision.START -> Unit
            GoogleSignInActivityDecision.CANCEL_AND_FINISH -> {
                settleCancellationIfNeeded()
                finish()
                return
            }
        }
        val clientId = intent.getStringExtra(EXTRA_CLIENT_ID)
        val scopes = intent.getStringArrayExtra(EXTRA_SCOPES) ?: arrayOf("email", "profile")
        val loginHint = intent.getStringExtra(EXTRA_LOGIN_HINT)
        val forcePicker = intent.getBooleanExtra(EXTRA_FORCE_PICKER, false)
        val forceCodeForRefreshToken = intent.getBooleanExtra(EXTRA_FORCE_CODE_FOR_REFRESH_TOKEN, false)
        val hostedDomain = intent.getStringExtra(EXTRA_HOSTED_DOMAIN)
        
        if (clientId == null) {
            resultDelivered = true
            AuthAdapter.onSignInError(8, "Missing client ID", origin, generation)
            finish()
            return
        }
        
        val gsoBuilder = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestServerAuthCode(clientId, forceCodeForRefreshToken)
            .requestEmail()

        if (hostedDomain != null) {
            gsoBuilder.setHostedDomain(hostedDomain)
        }
        
        scopes.forEach { scopeStr ->
            if (scopeStr != "email" && scopeStr != "profile" && scopeStr != "openid") {
                gsoBuilder.requestScopes(Scope(scopeStr))
            }
        }

        if (!forcePicker && loginHint != null) {
            gsoBuilder.setAccountName(loginHint)
        }
        
        val client = GoogleSignIn.getClient(this, gsoBuilder.build())
        signInClient = client
        
        if (forcePicker) {
            if (signOutInProgress) {
                startForcePickerSignOut(client)
            } else if (!launchDeferred) {
                startForcePickerSignOut(client)
            }
        } else {
            launchSignIn(client, launchToken)
        }
    }

    override fun onPostResume() {
        super.onPostResume()
        lifecycleStateSaved = false
        retryDeferredLaunch()
    }

    private fun startForcePickerSignOut(client: GoogleSignInClient) {
        val origin = intent.getStringExtra(EXTRA_ORIGIN) ?: "login"
        val generation = intent.getLongExtra(EXTRA_GENERATION, 0L)
        when (AuthAdapter.beginGooglePickerSignOut(this, origin, generation)) {
            GooglePickerSignOutDecision.START -> {
                signOutInProgress = true
                launchDeferred = true
                client.signOut().addOnCompleteListener { task ->
                    signOutInProgress = false
                    AuthAdapter.completeGooglePickerSignOut(this, task.isSuccessful)
                }
            }
            GooglePickerSignOutDecision.WAIT -> {
                signOutInProgress = true
                launchDeferred = true
            }
            GooglePickerSignOutDecision.READY -> {
                signOutInProgress = false
                launchDeferred = true
                launchSignIn(client, launchToken)
            }
            GooglePickerSignOutDecision.REJECT -> {
                signOutInProgress = false
                launchDeferred = false
                resultDelivered = true
                finish()
            }
        }
    }

    internal fun onGooglePickerSignOutChanged() {
        signOutInProgress = false
        launchDeferred = true
        retryDeferredLaunch()
    }

    private fun retryDeferredLaunch() {
        val client = signInClient ?: return
        if (!launchDeferred || signOutInProgress) return
        when (decideGoogleSignInLaunch(
            lifecycleStateSaved = lifecycleStateSaved,
            resultDelivered = resultDelivered,
            launchStarted = launchStarted,
            callbackLaunchToken = launchToken,
            currentLaunchToken = launchToken,
            activityFinishing = isFinishing,
            activityDestroyed = isDestroyed,
        )) {
            GoogleSignInLaunchDecision.LAUNCH -> {
                if (intent.getBooleanExtra(EXTRA_FORCE_PICKER, false)) {
                    startForcePickerSignOut(client)
                } else {
                    launchSignIn(client, launchToken)
                }
            }
            GoogleSignInLaunchDecision.DEFER -> Unit
            GoogleSignInLaunchDecision.IGNORE -> launchDeferred = false
        }
    }

    private fun launchSignIn(
        client: GoogleSignInClient,
        callbackToken: Long,
    ) {
        if (decideGoogleSignInLaunch(
                lifecycleStateSaved = lifecycleStateSaved,
                resultDelivered = resultDelivered,
                launchStarted = launchStarted,
                callbackLaunchToken = callbackToken,
                currentLaunchToken = launchToken,
                activityFinishing = isFinishing,
                activityDestroyed = isDestroyed,
        ) != GoogleSignInLaunchDecision.LAUNCH) {
            return
        }
        val origin = intent.getStringExtra(EXTRA_ORIGIN) ?: "login"
        val generation = intent.getLongExtra(EXTRA_GENERATION, 0L)
        if (!AuthAdapter.claimGooglePickerLaunch(this, origin, generation)) {
            launchDeferred = false
            resultDelivered = true
            finish()
            return
        }
        launchStarted = true
        launchDeferred = false
        signInLauncher.launch(client.signInIntent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (signOutInProgress && !resultDelivered && !launchStarted) {
            launchDeferred = true
        }
        lifecycleStateSaved = true
        launchToken = if (launchToken == Long.MAX_VALUE) 1L else launchToken + 1L
        outState.putBoolean(STATE_RESULT_DELIVERED, resultDelivered)
        outState.putBoolean(STATE_LAUNCH_STARTED, launchStarted)
        outState.putLong(STATE_LAUNCH_TOKEN, launchToken)
        outState.putBoolean(STATE_SIGN_OUT_IN_PROGRESS, signOutInProgress)
        outState.putBoolean(STATE_LAUNCH_DEFERRED, launchDeferred)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        launchToken = if (launchToken == Long.MAX_VALUE) 1L else launchToken + 1L
        AuthAdapter.unregisterGooglePickerActivity(
            this,
            intent.getStringExtra(EXTRA_ORIGIN) ?: "login",
            intent.getLongExtra(EXTRA_GENERATION, 0L),
        )
        if (shouldSettleGoogleSignInCancellation(resultDelivered, isFinishing)) {
            launchDeferred = false
            settleCancellationIfNeeded()
        }
        super.onDestroy()
    }

    private fun settleCancellationIfNeeded() {
        if (!resultDelivered) {
            resultDelivered = true
            val origin = intent.getStringExtra(EXTRA_ORIGIN) ?: "login"
            AuthAdapter.onSignInError(
                12501,
                "Google sign-in was dismissed before completing",
                origin,
                intent.getLongExtra(EXTRA_GENERATION, 0L),
            )
        }
    }
}

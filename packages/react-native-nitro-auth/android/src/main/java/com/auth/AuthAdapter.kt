@file:Suppress("DEPRECATION")
// The legacy com.google.android.gms.auth.api.signin.* API is used intentionally for:
//   • getLastSignedInAccount  – persists session across app restarts via GMS store; no drop-in replacement
//   • silentSignIn            – AuthorizationClient.authorize() still requires an Activity for interactive fallback
//   • revokeAccess            – no equivalent in Credential Manager or Identity.getAuthorizationClient()
// All modern entry-points use Credential Manager (One-Tap) unless the caller explicitly needs
// Android's account chooser semantics, which still require the legacy Google Sign-In flow.

package com.auth

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

object AuthAdapter {
    private const val TAG = "AuthAdapter"
    private val defaultMicrosoftScopes =
        listOf("openid", "email", "profile", "offline_access", "User.Read")

    @Volatile
    private var isInitialized = false

    private var appContext: Context? = null
    @Volatile
    private var currentActivity: Activity? = null
    private var googleSignInClient: GoogleSignInClient? = null
    private var lifecycleCallbacks: Application.ActivityLifecycleCallbacks? = null
    private var pendingScopes: List<String> = emptyList()
    private var pendingMicrosoftScopes: List<String> = emptyList()

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
    private var microsoftAuthInProgress = false

    @Volatile
    private var inMemoryMicrosoftRefreshToken: String? = null
    @Volatile
    private var inMemoryMicrosoftScopes: List<String> =
        defaultMicrosoftScopes

    // Module-scoped coroutine scope — cancelled on module invalidation via dispose().
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
        scopes: Array<String>?,
        expirationTime: Long?
    )

    @JvmStatic
    private external fun nativeOnLoginError(origin: String, error: String, underlyingError: String?)

    @JvmStatic
    private external fun nativeOnRefreshSuccess(idToken: String?, accessToken: String?, expirationTime: Long?)

    @JvmStatic
    private external fun nativeOnRefreshError(error: String, underlyingError: String?)

    @Synchronized
    fun initialize(context: Context) {
        if (isInitialized) return

        val applicationContext = context.applicationContext
        appContext = applicationContext

        val app = applicationContext as? Application
        if (app != null && lifecycleCallbacks == null) {
            lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { currentActivity = activity }
                override fun onActivityStarted(activity: Activity) { currentActivity = activity }
                override fun onActivityResumed(activity: Activity) { currentActivity = activity }
                override fun onActivityPaused(activity: Activity) { if (currentActivity == activity) currentActivity = null }
                override fun onActivityStopped(activity: Activity) { if (currentActivity == activity) currentActivity = null }
                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
                override fun onActivityDestroyed(activity: Activity) { if (currentActivity == activity) currentActivity = null }
            }
            app.registerActivityLifecycleCallbacks(lifecycleCallbacks)
        }

        try {
            // The native library is already loaded by NitroAuthOnLoad.initializeNative()
            // before this method is called from NitroAuthModule. We only need to wire
            // the Android context so that native methods can call back into the JVM.
            nativeInitialize(applicationContext)
            isInitialized = true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NitroAuth native bridge", e)
        }
    }

    fun dispose() {
        clearPkceState()
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
        isInitialized = false
    }

    fun onSignInSuccess(account: GoogleSignInAccount, scopes: List<String>, origin: String = "login") {
        appContext ?: return
        val expirationTime = getJwtExpirationTimeMs(account.idToken)
        nativeOnLoginSuccess(origin, "google", account.email, account.displayName,
            account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
            scopes.toTypedArray(), expirationTime)
    }

    fun onSignInError(errorCode: Int, message: String?, origin: String = "login") {
        val mappedError = when (errorCode) {
            12501 -> "cancelled"
            7 -> "network_error"
            8, 10 -> "configuration_error"
            else -> "unknown"
        }
        nativeOnLoginError(origin, mappedError, message)
    }

    @JvmStatic
    fun loginSync(
        context: Context,
        provider: String,
        googleClientId: String?,
        scopes: Array<String>?,
        loginHint: String?,
        useOneTap: Boolean,
        forceAccountPicker: Boolean = false,
        useLegacyGoogleSignIn: Boolean = false,
        tenant: String? = null,
        prompt: String? = null
    ) {
        if (provider == "apple") {
            nativeOnLoginError("login", "unsupported_provider", "Apple Sign-In is not supported on Android.")
            return
        }
        if (provider == "microsoft") {
            loginMicrosoft(context, scopes, loginHint, tenant, prompt, "login")
            return
        }
        if (provider != "google") {
            nativeOnLoginError("login", "unsupported_provider", "Unsupported provider: $provider")
            return
        }

        val ctx = appContext ?: context.applicationContext
        val clientId = googleClientId ?: getClientIdFromResources(ctx)
        if (clientId == null) {
            nativeOnLoginError("login", "configuration_error", "Google Client ID is required. Set it in app.json plugins.")
            return
        }

        val requestedScopes = scopes?.toList() ?: listOf("email", "profile")
        pendingScopes = requestedScopes

        if (useLegacyGoogleSignIn || forceAccountPicker) {
            loginLegacy(context, clientId, requestedScopes, loginHint, forceAccountPicker, "login")
            return
        }
        loginOneTap(context, clientId, requestedScopes, loginHint, forceAccountPicker, useOneTap, "login")
    }

    private fun loginMicrosoft(context: Context, scopes: Array<String>?, loginHint: String?, tenant: String?, prompt: String?, origin: String = "login") {
        val ctx = appContext ?: context.applicationContext
        val clientId = getMicrosoftClientIdFromResources(ctx)
        if (clientId == null) {
            nativeOnLoginError(origin, "configuration_error", "Microsoft Client ID is required. Set it in app.json plugins.")
            return
        }
        pendingOrigin = origin

        val effectiveTenant = tenant ?: getMicrosoftTenantFromResources(ctx) ?: "common"
        val effectiveScopes = scopes?.toList() ?: defaultMicrosoftScopes
        val effectivePrompt = prompt ?: "select_account"

        synchronized(this) {
            if (microsoftAuthInProgress) {
                nativeOnLoginError(
                    origin,
                    "operation_in_progress",
                    "Microsoft authentication already in progress",
                )
                return
            }
            microsoftAuthInProgress = true
            pendingMicrosoftScopes = effectiveScopes
        }

        val codeVerifier = generateCodeVerifier()
        val codeChallenge = generateCodeChallenge(codeVerifier)
        val state = UUID.randomUUID().toString()
        val nonce = UUID.randomUUID().toString()
        pendingPkceVerifier = codeVerifier
        pendingState = state
        pendingNonce = nonce
        pendingMicrosoftTenant = effectiveTenant
        pendingMicrosoftClientId = clientId

        val b2cDomain = getMicrosoftB2cDomainFromResources(ctx)
        pendingMicrosoftB2cDomain = b2cDomain
        val authBaseUrl = getMicrosoftAuthBaseUrl(effectiveTenant, b2cDomain)
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
            nativeOnLoginError(origin, "unknown", e.message)
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
        val code = uri.getQueryParameter("code")
        val state = uri.getQueryParameter("state")
        val error = uri.getQueryParameter("error")
        val errorDescription = uri.getQueryParameter("error_description")

        val origin = pendingOrigin
        if (error != null) {
            clearPkceState()
            val mappedError = mapMicrosoftOAuthError(error)
            nativeOnLoginError(origin, mappedError, errorDescription ?: error)
            return
        }
        if (state != pendingState) {
            clearPkceState()
            nativeOnLoginError(origin, "invalid_state", "State mismatch - possible CSRF attack")
            return
        }
        if (code == null) {
            clearPkceState()
            nativeOnLoginError(origin, "unknown", "No authorization code in response")
            return
        }
        exchangeCodeForTokens(code)
    }

    private fun exchangeCodeForTokens(code: String) {
        val ctx = appContext
        val clientId = pendingMicrosoftClientId
        val tenant = pendingMicrosoftTenant
        val verifier = pendingPkceVerifier
        val origin = pendingOrigin

        if (ctx == null || clientId == null || tenant == null || verifier == null) {
            clearPkceState()
            nativeOnLoginError(origin, "invalid_state", "Missing PKCE state for token exchange")
            return
        }

        val redirectUri = "msauth://${ctx.packageName}/${clientId}"
        val authBaseUrl = getMicrosoftAuthBaseUrl(tenant, pendingMicrosoftB2cDomain)
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

        moduleScope.launch {
            try {
                val url = java.net.URL(tokenUrl)
                val connection = url.openConnection() as java.net.HttpURLConnection
                try {
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 15_000
                    connection.requestMethod = "POST"
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    connection.doOutput = true

                    val postData = buildString {
                        append("client_id=${java.net.URLEncoder.encode(clientId, "UTF-8")}")
                        append("&code=${java.net.URLEncoder.encode(code, "UTF-8")}")
                        append("&redirect_uri=${java.net.URLEncoder.encode(redirectUri, "UTF-8")}")
                        append("&grant_type=authorization_code")
                        append("&code_verifier=${java.net.URLEncoder.encode(verifier, "UTF-8")}")
                    }
                    connection.outputStream.use { it.write(postData.toByteArray()) }

                    val responseCode = connection.responseCode
                    val responseBody = if (responseCode == 200) {
                        connection.inputStream.bufferedReader().use { it.readText() }
                    } else {
                        connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    }

                    withContext(Dispatchers.Main) {
                        handleTokenResponse(responseCode, responseBody, origin)
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    clearPkceState()
                    nativeOnLoginError(origin, "network_error", e.message)
                }
            }
        }
    }

    private fun handleTokenResponse(responseCode: Int, responseBody: String, origin: String) {
        if (responseCode != 200) {
            try {
                val json = JSONObject(responseBody)
                val error = json.optString("error", "token_error")
                val desc = json.optString("error_description", "Failed to exchange code for tokens")
                clearPkceState()
                nativeOnLoginError(origin, mapMicrosoftOAuthError(error), desc)
            } catch (e: Exception) {
                clearPkceState()
                nativeOnLoginError(origin, "token_error", "Failed to exchange code for tokens")
            }
            return
        }

        try {
            val json = JSONObject(responseBody)
            val idToken = json.optString("id_token")
            val accessToken = json.optString("access_token")
            val refreshToken = json.optString("refresh_token")
            val expiresIn = json.optLong("expires_in", 0)
            val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null

            if (idToken.isEmpty()) {
                clearPkceState()
                nativeOnLoginError(origin, "no_id_token", "No id_token in token response")
                return
            }

            val claims = decodeJwt(idToken)
            if (claims["nonce"] != pendingNonce) {
                clearPkceState()
                nativeOnLoginError(origin, "invalid_nonce", "Nonce mismatch - token may be replayed")
                return
            }

            val email = claims["preferred_username"] ?: claims["email"]
            val name = claims["name"]
            val grantedScopes = pendingMicrosoftScopes.ifEmpty { defaultMicrosoftScopes }

            if (refreshToken.isNotEmpty()) inMemoryMicrosoftRefreshToken = refreshToken
            inMemoryMicrosoftScopes = grantedScopes

            clearPkceState()
            nativeOnLoginSuccess(
                origin, "microsoft", email, name, null, idToken, accessToken, null,
                grantedScopes.toTypedArray(), expirationTime
            )
        } catch (e: Exception) {
            clearPkceState()
            nativeOnLoginError(origin, "parse_error", e.message)
        }
    }

    @Synchronized
    private fun clearPkceState() {
        pendingOrigin = "login"
        pendingPkceVerifier = null
        pendingState = null
        pendingNonce = null
        pendingMicrosoftTenant = null
        pendingMicrosoftClientId = null
        pendingMicrosoftB2cDomain = null
        pendingMicrosoftScopes = emptyList()
        microsoftAuthInProgress = false
    }

    private fun mapMicrosoftOAuthError(error: String): String {
        return when (error) {
            "access_denied", "interaction_required" -> "cancelled"
            "invalid_client", "unauthorized_client" -> "configuration_error"
            "invalid_grant", "invalid_request", "invalid_scope" -> "token_error"
            "temporarily_unavailable", "server_error" -> "network_error"
            else -> "token_error"
        }
    }

    private fun decodeJwt(token: String): Map<String, String> {
        return try {
            val parts = token.split(".")
            if (parts.size < 2) return emptyMap()
            val payload = String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
            val json = JSONObject(payload)
            val result = mutableMapOf<String, String>()
            json.keys().forEach { key ->
                val value = json.optString(key)
                if (value.isNotEmpty()) result[key] = value
            }
            result
        } catch (e: Exception) {
            Log.w(TAG, "Failed to decode JWT: ${e.message}")
            emptyMap()
        }
    }

    private fun getJwtExpirationTimeMs(idToken: String?): Long? {
        if (idToken.isNullOrEmpty()) return null
        val expSeconds = decodeJwt(idToken)["exp"]?.toLongOrNull() ?: return null
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

    private fun getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?): String {
        if (tenant.startsWith("https://")) {
            return if (tenant.endsWith("/")) tenant else "$tenant/"
        }
        return if (b2cDomain != null) {
            "https://$b2cDomain/tfp/$tenant/"
        } else {
            "https://login.microsoftonline.com/$tenant/"
        }
    }

    private fun loginOneTap(
        context: Context,
        clientId: String,
        scopes: List<String>,
        loginHint: String?,
        forceAccountPicker: Boolean,
        useOneTap: Boolean,
        origin: String = "login"
    ) {
        val activity = currentActivity ?: context as? Activity
        if (activity == null) {
            Log.w(TAG, "No Activity context available for One-Tap, falling back to legacy")
            return loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, origin)
        }

        val credentialManager = CredentialManager.create(activity)
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(clientId)
            .setAutoSelectEnabled(useOneTap && !forceAccountPicker)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        moduleScope.launch(Dispatchers.Main) {
            try {
                val result = credentialManager.getCredential(context = activity, request = request)
                handleCredentialResponse(result, scopes, origin)
            } catch (e: Exception) {
                Log.w(TAG, "One-Tap failed, falling back to legacy: ${e.message}")
                loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, origin)
            }
        }
    }

    private fun loginLegacy(
        context: Context,
        clientId: String,
        scopes: List<String>,
        loginHint: String?,
        forceAccountPicker: Boolean,
        origin: String = "login"
    ) {
        val ctx = appContext ?: context.applicationContext
        val intent = GoogleSignInActivity.createIntent(
            ctx, clientId, scopes.toTypedArray(), loginHint, forceAccountPicker, origin
        )
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
    }

    private fun handleCredentialResponse(response: GetCredentialResponse, scopes: List<String>, origin: String) {
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
            val expirationTime = getJwtExpirationTimeMs(googleIdTokenCredential.idToken)
            nativeOnLoginSuccess(
                origin, "google",
                googleIdTokenCredential.id,
                googleIdTokenCredential.displayName,
                googleIdTokenCredential.profilePictureUri?.toString(),
                googleIdTokenCredential.idToken,
                null, null,
                scopes.toTypedArray(),
                expirationTime
            )
        } else {
            Log.w(TAG, "Unsupported credential type: ${credential.type}")
            nativeOnLoginError(origin, "unknown", "Unsupported credential type: ${credential.type}")
        }
    }

    // requestScopesSync uses the legacy GoogleSignIn API to check the last signed-in account
    // because Credential Manager has no equivalent for querying existing account state.
    @JvmStatic
    fun requestScopesSync(context: Context, scopes: Array<String>) {
        val ctx = appContext ?: context.applicationContext
        val account = GoogleSignIn.getLastSignedInAccount(ctx)
        if (account != null) {
            val newScopes = scopes.map { Scope(it) }
            val grantedScopes = account.grantedScopes?.map { it.scopeUri }.orEmpty()
            val allScopes = (grantedScopes + scopes.toList()).distinct()
            if (GoogleSignIn.hasPermissions(account, *newScopes.toTypedArray())) {
                onSignInSuccess(account, allScopes, "scopes")
                return
            }
            val clientId = getClientIdFromResources(ctx)
            if (clientId == null) {
                nativeOnLoginError("scopes", "configuration_error", "Google Client ID not configured")
                return
            }
            val intent = GoogleSignInActivity.createIntent(ctx, clientId, allScopes.toTypedArray(), account.email, origin = "scopes")
            ctx.startActivity(intent)
            return
        }
        if (inMemoryMicrosoftRefreshToken != null) {
            val mergedScopes = (inMemoryMicrosoftScopes + scopes.toList()).distinct()
            val tenant = getMicrosoftTenantFromResources(ctx)
            loginMicrosoft(ctx, mergedScopes.toTypedArray(), null, tenant, null, "scopes")
            return
        }
        nativeOnLoginError("scopes", "not_signed_in", "No user logged in")
    }

    // refreshTokenSync uses the legacy silentSignIn because AuthorizationClient (the recommended
    // replacement) requires an Activity context which is not always available at refresh time.
    @JvmStatic
    fun refreshTokenSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        val account = GoogleSignIn.getLastSignedInAccount(ctx)
        if (account != null) {
            if (googleSignInClient == null) {
                val clientId = getClientIdFromResources(ctx)
                if (clientId == null) {
                    nativeOnRefreshError("configuration_error", "Google Client ID not configured")
                    return
                }
                val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestIdToken(clientId)
                    .requestServerAuthCode(clientId)
                    .requestEmail()
                    .build()
                googleSignInClient = GoogleSignIn.getClient(ctx, gso)
            }
            googleSignInClient!!.silentSignIn().addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val acc = task.result
                    nativeOnRefreshSuccess(acc?.idToken, null, getJwtExpirationTimeMs(acc?.idToken))
                } else {
                    nativeOnRefreshError("network_error", task.exception?.message ?: "Silent sign-in failed")
                }
            }
            return
        }
        val refreshToken = inMemoryMicrosoftRefreshToken
        if (refreshToken != null) {
            refreshMicrosoftTokenForRefresh(ctx, refreshToken)
            return
        }
        nativeOnRefreshError("not_signed_in", "No user logged in")
    }

    @JvmStatic
    fun hasPlayServices(context: Context): Boolean {
        val ctx = appContext ?: context.applicationContext ?: return false
        return GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(ctx) == ConnectionResult.SUCCESS
    }

    // revokeAccessSync uses the legacy GoogleSignIn client because Credential Manager has no
    // equivalent revoke API for the Google ID token flow.
    @JvmStatic
    fun logoutSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        clearPkceState()
        // Clear Credential Manager state (covers One-Tap / passkey credentials).
        moduleScope.launch {
            try {
                CredentialManager.create(ctx).clearCredentialState(ClearCredentialStateRequest())
            } catch (e: Exception) {
                Log.w(TAG, "clearCredentialState failed: ${e.message}")
            }
        }
        // Also clear legacy GMS sign-in state so getLastSignedInAccount returns null.
        val clientId = getClientIdFromResources(ctx)
        if (clientId != null) {
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(clientId).requestEmail().build()
            GoogleSignIn.getClient(ctx, gso).signOut()
        }
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftScopes = defaultMicrosoftScopes
    }

    @JvmStatic
    fun revokeAccessSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        clearPkceState()
        val clientId = getClientIdFromResources(ctx)
        if (clientId != null) {
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(clientId).requestServerAuthCode(clientId).requestEmail().build()
            GoogleSignIn.getClient(ctx, gso).revokeAccess()
        }
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftScopes = defaultMicrosoftScopes
    }

    private fun getClientIdFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_google_client_id", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    @JvmStatic
    fun restoreSession(context: Context) {
        val ctx = appContext ?: context.applicationContext ?: return
        @Suppress("DEPRECATION")
        val account = GoogleSignIn.getLastSignedInAccount(ctx)
        if (account != null) {
            val expirationTime = getJwtExpirationTimeMs(account.idToken)
            nativeOnLoginSuccess("silent", "google", account.email, account.displayName,
                account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
                account.grantedScopes?.map { it.scopeUri }?.toTypedArray(), expirationTime)
        } else {
            val refreshToken = inMemoryMicrosoftRefreshToken
            if (refreshToken != null) {
                refreshMicrosoftToken(ctx, refreshToken)
            } else {
                nativeOnLoginError("silent", "not_signed_in", "No session")
            }
        }
    }

    private fun refreshMicrosoftToken(context: Context, refreshToken: String) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = getMicrosoftTenantFromResources(context) ?: "common"
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        val effectiveScopes = inMemoryMicrosoftScopes.ifEmpty { defaultMicrosoftScopes }

        if (clientId == null) {
            nativeOnLoginError("silent", "configuration_error", "Microsoft Client ID is required for refresh")
            return
        }

        val authBaseUrl = getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

        moduleScope.launch {
            try {
                val url = java.net.URL(tokenUrl)
                val connection = url.openConnection() as java.net.HttpURLConnection
                try {
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 15_000
                    connection.requestMethod = "POST"
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    connection.doOutput = true

                    val postData = buildString {
                        append("client_id=${java.net.URLEncoder.encode(clientId, "UTF-8")}")
                        append("&grant_type=refresh_token")
                        append("&refresh_token=${java.net.URLEncoder.encode(refreshToken, "UTF-8")}")
                    }
                    connection.outputStream.use { it.write(postData.toByteArray()) }

                    val responseCode = connection.responseCode
                    val responseBody = if (responseCode == 200) {
                        connection.inputStream.bufferedReader().use { it.readText() }
                    } else {
                        connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    }

                    withContext(Dispatchers.Main) {
                        if (responseCode == 200) {
                            val json = JSONObject(responseBody)
                            val newIdToken = json.optString("id_token")
                            val newAccessToken = json.optString("access_token")
                            val newRefreshToken = json.optString("refresh_token")
                            val expiresIn = json.optLong("expires_in", 0)
                            val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null
                            val claims = decodeJwt(newIdToken)

                            if (newRefreshToken.isNotEmpty()) inMemoryMicrosoftRefreshToken = newRefreshToken
                            inMemoryMicrosoftScopes = effectiveScopes

                            nativeOnLoginSuccess("silent", "microsoft",
                                claims["preferred_username"] ?: claims["email"],
                                claims["name"], null,
                                newIdToken, newAccessToken, null, effectiveScopes.toTypedArray(), expirationTime)
                        } else {
                            if (responseCode in 400..499) {
                                inMemoryMicrosoftRefreshToken = null  // Token is invalid, clear it
                            }
                            val mappedError = try {
                                val json = org.json.JSONObject(responseBody)
                                val errorCode = json.optString("error", "token_error")
                                val errorDesc = json.optString("error_description", "Token refresh failed")
                                Pair(mapMicrosoftOAuthError(errorCode), errorDesc)
                            } catch (e: Exception) {
                                Pair("token_error", "Token refresh failed")
                            }
                            nativeOnLoginError("silent", mappedError.first, mappedError.second)
                        }
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    nativeOnLoginError("silent", "network_error", e.message)
                }
            }
        }
    }

    private fun refreshMicrosoftTokenForRefresh(context: Context, refreshToken: String) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = getMicrosoftTenantFromResources(context) ?: "common"
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        val effectiveScopes = inMemoryMicrosoftScopes.ifEmpty { defaultMicrosoftScopes }

        if (clientId == null) {
            nativeOnRefreshError("configuration_error", "Microsoft Client ID not configured")
            return
        }

        val authBaseUrl = getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

        moduleScope.launch {
            try {
                val url = java.net.URL(tokenUrl)
                val connection = url.openConnection() as java.net.HttpURLConnection
                try {
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 15_000
                    connection.requestMethod = "POST"
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    connection.doOutput = true

                    val postData = buildString {
                        append("client_id=${java.net.URLEncoder.encode(clientId, "UTF-8")}")
                        append("&grant_type=refresh_token")
                        append("&refresh_token=${java.net.URLEncoder.encode(refreshToken, "UTF-8")}")
                    }
                    connection.outputStream.use { it.write(postData.toByteArray()) }

                    val responseCode = connection.responseCode
                    val responseBody = if (responseCode == 200) {
                        connection.inputStream.bufferedReader().use { it.readText() }
                    } else {
                        connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    }

                    withContext(Dispatchers.Main) {
                        if (responseCode == 200) {
                            val json = JSONObject(responseBody)
                            val newIdToken = json.optString("id_token")
                            val newAccessToken = json.optString("access_token")
                            val newRefreshToken = json.optString("refresh_token")
                            val expiresIn = json.optLong("expires_in", 0)
                            val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null

                            if (newRefreshToken.isNotEmpty()) inMemoryMicrosoftRefreshToken = newRefreshToken
                            inMemoryMicrosoftScopes = effectiveScopes

                            nativeOnRefreshSuccess(
                                newIdToken.ifEmpty { null },
                                newAccessToken.ifEmpty { null },
                                expirationTime
                            )
                        } else {
                            if (responseCode in 400..499) {
                                inMemoryMicrosoftRefreshToken = null
                            }
                            val errorBody = responseBody
                            val mappedError = try {
                                val json = org.json.JSONObject(errorBody)
                                val errorCode = json.optString("error", "token_error")
                                val errorDesc = json.optString("error_description", "Token refresh failed")
                                Pair(mapMicrosoftOAuthError(errorCode), errorDesc)
                            } catch (e: Exception) {
                                Pair("token_error", "Token refresh failed")
                            }
                            nativeOnRefreshError(mappedError.first, mappedError.second)
                        }
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    nativeOnRefreshError("network_error", e.message)
                }
            }
        }
    }
}

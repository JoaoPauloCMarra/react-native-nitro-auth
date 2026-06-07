@file:Suppress("DEPRECATION")

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
import kotlinx.coroutines.CancellationException
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
    private var hasLegacyGoogleSession = false

    @Volatile
    private var inMemoryMicrosoftRefreshToken: String? = null
    @Volatile
    private var inMemoryMicrosoftScopes: List<String> =
        defaultMicrosoftScopes

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
        hasLegacyGoogleSession = true
        val expirationTime = getJwtExpirationTimeMs(account.idToken)
        nativeOnLoginSuccess(origin, "google", account.email, account.displayName,
            account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
            account.id, null, null, scopes.toTypedArray(), expirationTime)
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
        openIDRealm: String? = null
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
            loginLegacy(context, clientId, requestedScopes, loginHint, forceAccountPicker, forceCodeForRefreshToken, hostedDomain, "login")
            return
        }
        loginOneTap(context, clientId, requestedScopes, loginHint, nonce, forceAccountPicker, useOneTap, filterByAuthorizedAccounts, requestVerifiedPhoneNumber, hostedDomain, "login")
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
        if (authBaseUrl == null) {
            clearPkceState()
            nativeOnLoginError(origin, "configuration_error", "Invalid Microsoft tenant or B2C domain")
            return
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
            nativeOnLoginError(origin, "token_error", "No authorization code in response")
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
        if (authBaseUrl == null) {
            clearPkceState()
            nativeOnLoginError(origin, "configuration_error", "Invalid Microsoft tenant or B2C domain")
            return
        }
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
            } catch (e: CancellationException) {
                clearPkceState()
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
                null, null, null, grantedScopes.toTypedArray(), expirationTime
            )
        } catch (e: Exception) {
            clearPkceState()
            nativeOnLoginError(origin, "parse_error", e.message)
        }
    }

    private fun clearCredentialManagerState(context: Context) {
        moduleScope.launch {
            try {
                CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
            } catch (e: Exception) {
                Log.w(TAG, "clearCredentialState failed: ${e.message}")
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
        return hasLegacyGoogleSession || GoogleSignIn.getLastSignedInAccount(context) != null
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

    private fun hostedDomainFromEmail(email: String?): String? {
        val parts = email?.split("@", limit = 2) ?: return null
        return parts.getOrNull(1)
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

    private fun getMicrosoftAuthBaseUrl(tenant: String, b2cDomain: String?): String? {
        val trimmedTenant = tenant.trim()

        return if (!b2cDomain.isNullOrBlank()) {
            val trimmedDomain = b2cDomain.trim().lowercase()
            if (!isValidMicrosoftDomain(trimmedDomain)) return null
            val b2cTenantPath = getMicrosoftB2cTenantPath(trimmedTenant, trimmedDomain) ?: return null
            "https://$trimmedDomain/$b2cTenantPath/"
        } else {
            if (!isValidMicrosoftTenant(trimmedTenant)) return null
            "https://login.microsoftonline.com/$trimmedTenant/"
        }
    }

    private fun isValidMicrosoftTenant(value: String): Boolean {
        return Regex("^(common|organizations|consumers|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$").matches(value)
    }

    private fun getMicrosoftB2cTenantPath(value: String, domain: String): String? {
        if (isValidMicrosoftB2cTenantPath(value)) return value
        if (!isValidMicrosoftB2cPolicy(value)) return null
        val tenantName = getMicrosoftB2cTenantName(domain) ?: return null
        return "$tenantName.onmicrosoft.com/$value"
    }

    private fun getMicrosoftB2cTenantName(domain: String): String? {
        val suffix = ".b2clogin.com"
        if (!domain.endsWith(suffix)) return null
        val tenantName = domain.removeSuffix(suffix)
        return if (Regex("^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$").matches(tenantName)) tenantName else null
    }

    private fun isValidMicrosoftB2cTenantPath(value: String): Boolean {
        return Regex("^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9][A-Za-z0-9._-]{0,127})/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").matches(value)
    }

    private fun isValidMicrosoftB2cPolicy(value: String): Boolean {
        return Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").matches(value)
    }

    private fun isValidMicrosoftDomain(value: String): Boolean {
        return Regex("^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$").matches(value)
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
        origin: String = "login"
    ) {
        val activity = currentActivity ?: context as? Activity
        if (activity == null) {
            Log.w(TAG, "No Activity context available for One-Tap, falling back to legacy")
            return loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, false, hostedDomain, origin)
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
                handleCredentialResponse(result, scopes, origin)
            } catch (e: CancellationException) {
                return@launch
            } catch (e: Exception) {
                Log.w(TAG, "One-Tap failed, falling back to legacy: ${e.message}")
                loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker, false, hostedDomain, origin)
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
        origin: String = "login"
    ) {
        val ctx = appContext ?: context.applicationContext
        val intent = GoogleSignInActivity.createIntent(
            ctx, clientId, scopes.toTypedArray(), loginHint, forceAccountPicker, forceCodeForRefreshToken, hostedDomain, origin
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
                googleIdTokenCredential.email,
                googleIdTokenCredential.displayName,
                googleIdTokenCredential.profilePictureUri?.toString(),
                googleIdTokenCredential.idToken,
                null, null,
                googleIdTokenCredential.id,
                googleIdTokenCredential.phoneNumber,
                hostedDomainFromEmail(googleIdTokenCredential.email),
                scopes.toTypedArray(),
                expirationTime
            )
        } else {
            Log.w(TAG, "Unsupported credential type: ${credential.type}")
            nativeOnLoginError(origin, "unknown", "Unsupported credential type: ${credential.type}")
        }
    }

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

    @JvmStatic
    fun logoutSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        clearPkceState()
        if (hasLegacyGoogleAccount(ctx)) {
            getLegacyGoogleClient(ctx)?.signOut()
        }
        hasLegacyGoogleSession = false
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftScopes = defaultMicrosoftScopes
    }

    @JvmStatic
    fun revokeAccessSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        clearPkceState()
        clearCredentialManagerState(ctx)
        if (hasLegacyGoogleAccount(ctx)) {
            getLegacyGoogleClient(ctx)?.revokeAccess()
        }
        hasLegacyGoogleSession = false
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
            hasLegacyGoogleSession = true
            val expirationTime = getJwtExpirationTimeMs(account.idToken)
            nativeOnLoginSuccess("silent", "google", account.email, account.displayName,
                account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
                account.id, null, null, account.grantedScopes?.map { it.scopeUri }?.toTypedArray(), expirationTime)
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
        if (authBaseUrl == null) {
            nativeOnLoginError("silent", "configuration_error", "Invalid Microsoft tenant or B2C domain")
            return
        }
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
                                newIdToken, newAccessToken, null, null, null, null, effectiveScopes.toTypedArray(), expirationTime)
                        } else {
                            if (responseCode in 400..499) {
                                inMemoryMicrosoftRefreshToken = null
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
            } catch (e: CancellationException) {
                nativeOnLoginError("silent", "cancelled", e.message)
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
        if (authBaseUrl == null) {
            nativeOnRefreshError("configuration_error", "Invalid Microsoft tenant or B2C domain")
            return
        }
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
            } catch (e: CancellationException) {
                nativeOnRefreshError("cancelled", e.message)
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    nativeOnRefreshError("network_error", e.message)
                }
            }
        }
    }
}

@file:Suppress("DEPRECATION")

package com.auth

import android.content.Context
import android.os.Bundle
import android.util.Log
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.api.Scope
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import java.util.UUID
import org.json.JSONObject
import android.util.Base64

object AuthAdapter {
    private const val TAG = "AuthAdapter"
    
    private var appContext: Context? = null
    private var currentActivity: Activity? = null
    private var googleSignInClient: GoogleSignInClient? = null
    private var pendingScopes: List<String> = emptyList()
    private var pendingMicrosoftScopes: List<String> = emptyList()
    
    private var pendingPkceVerifier: String? = null
    private var pendingState: String? = null
    private var pendingNonce: String? = null
    private var pendingMicrosoftTenant: String? = null
    private var pendingMicrosoftClientId: String? = null
    private var pendingMicrosoftB2cDomain: String? = null
    
    private var inMemoryMicrosoftRefreshToken: String? = null
    private var inMemoryMicrosoftScopes: List<String> =
        listOf("openid", "email", "profile", "offline_access", "User.Read")

    @JvmStatic
    private external fun nativeInitialize(context: Context)
    
    @JvmStatic
    private external fun nativeOnLoginSuccess(
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
    private external fun nativeOnLoginError(error: String, underlyingError: String?)

    @JvmStatic
    private external fun nativeOnRefreshSuccess(idToken: String?, accessToken: String?, expirationTime: Long?)

    @JvmStatic
    private external fun nativeOnRefreshError(error: String, underlyingError: String?)

    fun initialize(context: Context) {
        val app = context.applicationContext as? Application
        appContext = app
        
        app?.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { currentActivity = activity }
            override fun onActivityStarted(activity: Activity) { currentActivity = activity }
            override fun onActivityResumed(activity: Activity) { currentActivity = activity }
            override fun onActivityPaused(activity: Activity) { if (currentActivity == activity) currentActivity = null }
            override fun onActivityStopped(activity: Activity) { if (currentActivity == activity) currentActivity = null }
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) { if (currentActivity == activity) currentActivity = null }
        })

        try {
            System.loadLibrary("NitroAuth")
            nativeInitialize(appContext!!)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load NitroAuth library", e)
        }
    }

    fun onSignInSuccess(account: GoogleSignInAccount, scopes: List<String>) {
        appContext ?: return
        nativeOnLoginSuccess("google", account.email, account.displayName,
                            account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode, scopes.toTypedArray(), null)
    }

    fun onSignInError(errorCode: Int, message: String?) {
        val mappedError = when (errorCode) {
            12501 -> "cancelled"
            7 -> "network_error"
            8, 10 -> "configuration_error"
            else -> "unknown"
        }
        nativeOnLoginError(mappedError, message)
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
            nativeOnLoginError("unsupported_provider", "Apple Sign-In is not supported on Android.")
            return
        }

        if (provider == "microsoft") {
            loginMicrosoft(context, scopes, loginHint, tenant, prompt)
            return
        }

        if (provider != "google") {
            nativeOnLoginError("unsupported_provider", "Unsupported provider: $provider")
            return
        }

        val ctx = appContext ?: context.applicationContext
        val clientId = googleClientId ?: getClientIdFromResources(ctx)
        if (clientId == null) {
            nativeOnLoginError("configuration_error", "Google Client ID is required. Set it in app.json plugins.")
            return
        }

        val requestedScopes = scopes?.toList() ?: listOf("email", "profile")
        pendingScopes = requestedScopes

        if (useLegacyGoogleSignIn) {
            loginLegacy(context, clientId, requestedScopes, loginHint, forceAccountPicker)
            return
        }

        loginOneTap(context, clientId, requestedScopes, loginHint, forceAccountPicker, useOneTap)
    }

    private fun loginMicrosoft(context: Context, scopes: Array<String>?, loginHint: String?, tenant: String?, prompt: String?) {
        val ctx = appContext ?: context.applicationContext
        val clientId = getMicrosoftClientIdFromResources(ctx)
        if (clientId == null) {
            nativeOnLoginError("configuration_error", "Microsoft Client ID is required. Set it in app.json plugins.")
            return
        }

        val effectiveTenant = tenant ?: getMicrosoftTenantFromResources(ctx) ?: "common"
        val effectiveScopes = scopes?.toList() ?: listOf("openid", "email", "profile", "offline_access", "User.Read")
        val effectivePrompt = prompt ?: "select_account"
        pendingMicrosoftScopes = effectiveScopes

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
            nativeOnLoginError("unknown", e.message)
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

        if (error != null) {
            clearPkceState()
            nativeOnLoginError(error, errorDescription)
            return
        }

        if (state != pendingState) {
            clearPkceState()
            nativeOnLoginError("invalid_state", "State mismatch - possible CSRF attack")
            return
        }

        if (code == null) {
            clearPkceState()
            nativeOnLoginError("unknown", "No authorization code in response")
            return
        }

        exchangeCodeForTokens(code)
    }

    private fun exchangeCodeForTokens(code: String) {
        val ctx = appContext
        val clientId = pendingMicrosoftClientId
        val tenant = pendingMicrosoftTenant
        val verifier = pendingPkceVerifier

        if (ctx == null || clientId == null || tenant == null || verifier == null) {
            clearPkceState()
            nativeOnLoginError("invalid_state", "Missing PKCE state for token exchange")
            return
        }

        val redirectUri = "msauth://${ctx.packageName}/${clientId}"
        val authBaseUrl = getMicrosoftAuthBaseUrl(tenant, pendingMicrosoftB2cDomain)
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = java.net.URL(tokenUrl)
                val connection = url.openConnection() as java.net.HttpURLConnection
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
                    connection.inputStream.bufferedReader().readText()
                } else {
                    connection.errorStream?.bufferedReader()?.readText() ?: ""
                }

                CoroutineScope(Dispatchers.Main).launch {
                    handleTokenResponse(responseCode, responseBody)
                }
            } catch (e: Exception) {
                CoroutineScope(Dispatchers.Main).launch {
                    clearPkceState()
                    nativeOnLoginError("network_error", e.message)
                }
            }
        }
    }

    private fun handleTokenResponse(responseCode: Int, responseBody: String) {
        if (responseCode != 200) {
            try {
                val json = JSONObject(responseBody)
                val error = json.optString("error", "token_error")
                val desc = json.optString("error_description", "Failed to exchange code for tokens")
                clearPkceState()
                nativeOnLoginError(error, desc)
            } catch (e: Exception) {
                clearPkceState()
                nativeOnLoginError("token_error", "Failed to exchange code for tokens")
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
                nativeOnLoginError("no_id_token", "No id_token in token response")
                return
            }

            val claims = decodeJwt(idToken)
            val tokenNonce = claims["nonce"]
            if (tokenNonce != pendingNonce) {
                clearPkceState()
                nativeOnLoginError("invalid_nonce", "Nonce mismatch - token may be replayed")
                return
            }

            val email = claims["preferred_username"] ?: claims["email"]
            val name = claims["name"]

            if (refreshToken.isNotEmpty()) {
                inMemoryMicrosoftRefreshToken = refreshToken
            }
            inMemoryMicrosoftScopes = pendingMicrosoftScopes.ifEmpty {
                listOf("openid", "email", "profile", "offline_access", "User.Read")
            }

            clearPkceState()
            nativeOnLoginSuccess(
                "microsoft",
                email,
                name,
                null,
                idToken,
                accessToken,
                null,
                pendingMicrosoftScopes.toTypedArray(),
                expirationTime
            )
        } catch (e: Exception) {
            clearPkceState()
            nativeOnLoginError("parse_error", e.message)
        }
    }

    private fun saveMicrosoftRefreshToken(refreshToken: String) {
        inMemoryMicrosoftRefreshToken = refreshToken
    }

    private fun getMicrosoftRefreshToken(): String? {
        return inMemoryMicrosoftRefreshToken
    }

    private fun clearPkceState() {
        pendingPkceVerifier = null
        pendingState = null
        pendingNonce = null
        pendingMicrosoftTenant = null
        pendingMicrosoftClientId = null
        pendingMicrosoftB2cDomain = null
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
            emptyMap()
        }
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
        useOneTap: Boolean
    ) {
        val activity = currentActivity ?: context as? Activity
        if (activity == null) {
            Log.w(TAG, "No Activity context available for One-Tap, falling back to legacy")
            return loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker)
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

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val result = credentialManager.getCredential(context = activity, request = request)
                handleCredentialResponse(result, scopes)
            } catch (e: Exception) {
                Log.w(TAG, "One-Tap failed, falling back to legacy: ${e.message}")
                loginLegacy(context, clientId, scopes, loginHint, forceAccountPicker)
            }
        }
    }

    private fun loginLegacy(
        context: Context,
        clientId: String,
        scopes: List<String>,
        loginHint: String?,
        forceAccountPicker: Boolean
    ) {
        val ctx = appContext ?: context.applicationContext
        val intent = GoogleSignInActivity.createIntent(
            ctx,
            clientId,
            scopes.toTypedArray(),
            loginHint,
            forceAccountPicker
        )
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
    }

    private fun handleCredentialResponse(response: GetCredentialResponse, scopes: List<String>) {
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
            nativeOnLoginSuccess(
                "google",
                googleIdTokenCredential.id,
                googleIdTokenCredential.displayName,
                googleIdTokenCredential.profilePictureUri?.toString(),
                googleIdTokenCredential.idToken,
                null,
                null,
                scopes.toTypedArray(),
                null
            )
        } else {
            Log.w(TAG, "Unsupported credential type: ${credential.type}")
            nativeOnLoginError("unknown", "Unsupported credential type: ${credential.type}")
        }
    }

    @JvmStatic
    fun requestScopesSync(context: Context, scopes: Array<String>) {
        val ctx = appContext ?: context.applicationContext
        val account = GoogleSignIn.getLastSignedInAccount(ctx)
        if (account != null) {
            val newScopes = scopes.map { Scope(it) }
            if (GoogleSignIn.hasPermissions(account, *newScopes.toTypedArray())) {
                onSignInSuccess(account, (pendingScopes + scopes.toList()).distinct())
                return
            }
            val clientId = getClientIdFromResources(ctx)
            if (clientId == null) {
                nativeOnLoginError("configuration_error", "Google Client ID not configured")
                return
            }
            val allScopes = (pendingScopes + scopes.toList()).distinct()
            val intent = GoogleSignInActivity.createIntent(ctx, clientId, allScopes.toTypedArray(), account.email)
            ctx.startActivity(intent)
            return
        }
        if (inMemoryMicrosoftRefreshToken != null) {
            val mergedScopes = (inMemoryMicrosoftScopes + scopes.toList()).distinct()
            val tenant = getMicrosoftTenantFromResources(ctx)
            loginMicrosoft(ctx, mergedScopes.toTypedArray(), null, tenant, null)
            return
        }
        nativeOnLoginError("unknown", "No user logged in")
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
                    nativeOnRefreshSuccess(acc?.idToken, null, null)
                } else {
                    nativeOnRefreshError("network_error", task.exception?.message ?: "Silent sign-in failed")
                }
            }
            return
        }
        val refreshToken = getMicrosoftRefreshToken()
        if (refreshToken != null) {
            refreshMicrosoftTokenForRefresh(ctx, refreshToken)
            return
        }
        nativeOnRefreshError("unknown", "No user logged in")
    }

    @JvmStatic
    fun hasPlayServices(context: Context): Boolean {
        val ctx = context.applicationContext ?: appContext ?: return false
        val availability = GoogleApiAvailability.getInstance()
        val result = availability.isGooglePlayServicesAvailable(ctx)
        return result == ConnectionResult.SUCCESS
    }

    @JvmStatic
    fun logoutSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        val clientId = getClientIdFromResources(ctx)
        if (clientId != null) {
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(clientId)
                .requestServerAuthCode(clientId)
                .requestEmail()
                .build()
            GoogleSignIn.getClient(ctx, gso).signOut()
        }
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftScopes = listOf("openid", "email", "profile", "offline_access", "User.Read")
    }

    @JvmStatic
    fun revokeAccessSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        val clientId = getClientIdFromResources(ctx)
        if (clientId != null) {
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(clientId)
                .requestServerAuthCode(clientId)
                .requestEmail()
                .build()
            GoogleSignIn.getClient(ctx, gso).revokeAccess()
        }
        inMemoryMicrosoftRefreshToken = null
        inMemoryMicrosoftScopes = listOf("openid", "email", "profile", "offline_access", "User.Read")
    }

    private fun getClientIdFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_google_client_id", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    @JvmStatic
    fun restoreSession(context: Context) {
        val ctx = context.applicationContext ?: appContext ?: context
        val account = GoogleSignIn.getLastSignedInAccount(ctx)
        if (account != null) {
            nativeOnLoginSuccess("google", account.email, account.displayName,
                                account.photoUrl?.toString(), account.idToken, null, account.serverAuthCode,
                                account.grantedScopes?.map { it.scopeUri }?.toTypedArray(), null)
        } else {
            val refreshToken = getMicrosoftRefreshToken()
            if (refreshToken != null) {
                refreshMicrosoftToken(ctx, refreshToken)
            } else {
                nativeOnLoginError("unknown", "No session")
            }
        }
    }

    private fun refreshMicrosoftToken(context: Context, refreshToken: String) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = getMicrosoftTenantFromResources(context) ?: "common"
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        
        if (clientId == null) {
            nativeOnLoginError("configuration_error", "Microsoft Client ID is required for refresh")
            return
        }

        val authBaseUrl = getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = java.net.URL(tokenUrl)
                val connection = url.openConnection() as java.net.HttpURLConnection
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
                    connection.inputStream.bufferedReader().readText()
                } else {
                    connection.errorStream?.bufferedReader()?.readText() ?: ""
                }

                CoroutineScope(Dispatchers.Main).launch {
                    if (responseCode == 200) {
                        val json = JSONObject(responseBody)
                        val newIdToken = json.optString("id_token")
                        val newAccessToken = json.optString("access_token")
                        val newRefreshToken = json.optString("refresh_token")
                        val expiresIn = json.optLong("expires_in", 0)
                        val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null

                        val claims = decodeJwt(newIdToken)
                        val email = claims["preferred_username"] ?: claims["email"]
                        val name = claims["name"]

                        if (newRefreshToken.isNotEmpty()) {
                            saveMicrosoftRefreshToken(newRefreshToken)
                        }
                        inMemoryMicrosoftScopes = pendingMicrosoftScopes.ifEmpty {
                            listOf("openid", "email", "profile", "offline_access", "User.Read")
                        }

                        nativeOnLoginSuccess("microsoft", email, name, null, newIdToken, newAccessToken, null, null, expirationTime)
                    } else {
                        nativeOnLoginError("refresh_failed", "Microsoft token refresh failed")
                    }
                }
            } catch (e: Exception) {
                CoroutineScope(Dispatchers.Main).launch {
                    nativeOnLoginError("network_error", e.message)
                }
            }
        }
    }

    private fun refreshMicrosoftTokenForRefresh(context: Context, refreshToken: String) {
        val clientId = getMicrosoftClientIdFromResources(context)
        val tenant = getMicrosoftTenantFromResources(context) ?: "common"
        val b2cDomain = getMicrosoftB2cDomainFromResources(context)
        if (clientId == null) {
            nativeOnRefreshError("configuration_error", "Microsoft Client ID not configured")
            return
        }
        val authBaseUrl = getMicrosoftAuthBaseUrl(tenant, b2cDomain)
        val tokenUrl = "${authBaseUrl}oauth2/v2.0/token"
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = java.net.URL(tokenUrl)
                val connection = url.openConnection() as java.net.HttpURLConnection
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
                    connection.inputStream.bufferedReader().readText()
                } else {
                    connection.errorStream?.bufferedReader()?.readText() ?: ""
                }
                CoroutineScope(Dispatchers.Main).launch {
                    if (responseCode == 200) {
                        val json = JSONObject(responseBody)
                        val newIdToken = json.optString("id_token")
                        val newAccessToken = json.optString("access_token")
                        val newRefreshToken = json.optString("refresh_token")
                        val expiresIn = json.optLong("expires_in", 0)
                        val expirationTime = if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000 else null
                        val claims = decodeJwt(newIdToken)
                        val email = claims["preferred_username"] ?: claims["email"]
                        val name = claims["name"]
                        if (newRefreshToken.isNotEmpty()) {
                            saveMicrosoftRefreshToken(newRefreshToken)
                        }
                        inMemoryMicrosoftScopes = pendingMicrosoftScopes.ifEmpty {
                            listOf("openid", "email", "profile", "offline_access", "User.Read")
                        }
                        nativeOnRefreshSuccess(
                            newIdToken.ifEmpty { null },
                            newAccessToken.ifEmpty { null },
                            expirationTime
                        )
                    } else {
                        nativeOnRefreshError("refresh_failed", "Microsoft token refresh failed")
                    }
                }
            } catch (e: Exception) {
                CoroutineScope(Dispatchers.Main).launch {
                    nativeOnRefreshError("network_error", e.message)
                }
            }
        }
    }

}

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

object AuthAdapter {
    private const val TAG = "AuthAdapter"
    private const val PREF_NAME = "nitro_auth"
    
    private var appContext: Context? = null
    private var currentActivity: Activity? = null
    private var googleSignInClient: GoogleSignInClient? = null
    private var pendingScopes: List<String> = emptyList()

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
        val ctx = appContext ?: return
        saveUser(ctx, "google", account.email, account.displayName,
                 account.photoUrl?.toString(), account.idToken, account.serverAuthCode, scopes)
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
    fun loginSync(context: Context, provider: String, googleClientId: String?, scopes: Array<String>?, loginHint: String?, useOneTap: Boolean, forceAccountPicker: Boolean = false) {
        if (provider == "apple") {
            nativeOnLoginError("unsupported_provider", "Apple Sign-In is not supported on Android.")
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

        if (useOneTap && !forceAccountPicker) {
            loginOneTap(context, clientId, requestedScopes)
        } else {
            val intent = GoogleSignInActivity.createIntent(ctx, clientId, requestedScopes.toTypedArray(), loginHint, forceAccountPicker)
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
        }
    }

    private fun loginOneTap(context: Context, clientId: String, scopes: List<String>) {
        val activity = currentActivity ?: context as? Activity
        if (activity == null) {
            Log.w(TAG, "No Activity context available for One-Tap, falling back to legacy")
            return loginLegacy(context, clientId, scopes)
        }
        
        val credentialManager = CredentialManager.create(activity)
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(clientId)
            .setAutoSelectEnabled(false)
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
                loginLegacy(context, clientId, scopes)
            }
        }
    }

    private fun loginLegacy(context: Context, clientId: String, scopes: List<String>) {
        val ctx = appContext ?: context.applicationContext
        val intent = GoogleSignInActivity.createIntent(ctx, clientId, scopes.toTypedArray(), null)
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
        if (account == null) {
            nativeOnLoginError("unknown", "No user logged in")
            return
        }

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
    }

    @JvmStatic
    fun refreshTokenSync(context: Context) {
        val ctx = appContext ?: context.applicationContext
        if (googleSignInClient == null) {
            val account = GoogleSignIn.getLastSignedInAccount(ctx)
            if (account == null) {
                nativeOnRefreshError("unknown", "No user logged in")
                return
            }
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
                val account = task.result
                nativeOnRefreshSuccess(account?.idToken, null, null)
            } else {
                nativeOnRefreshError("network_error", task.exception?.message ?: "Silent sign-in failed")
            }
        }
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
        clearUser(ctx)
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
        clearUser(ctx)
    }

    private fun getClientIdFromResources(context: Context): String? {
        val resId = context.resources.getIdentifier("nitro_auth_google_client_id", "string", context.packageName)
        return if (resId != 0) context.getString(resId) else null
    }

    @JvmStatic
    fun getUserJson(context: Context): String? {
        val pref = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return pref.getString("user_json", null)
    }

    @JvmStatic
    fun setUserJson(context: Context, json: String) {
        val pref = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        pref.edit().putString("user_json", json).apply()
    }

    @JvmStatic
    fun clearUser(context: Context) {
        val pref = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        pref.edit().clear().apply()
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
            val json = getUserJson(ctx)
            if (json != null) {
                val provider = if (json.contains("\"provider\":\"google\"")) "google" else "apple"
                val email = extractJsonValue(json, "email")
                val name = extractJsonValue(json, "name")
                val photo = extractJsonValue(json, "photo")
                val idToken = extractJsonValue(json, "idToken")
                val serverAuthCode = extractJsonValue(json, "serverAuthCode")
                nativeOnLoginSuccess(provider, email, name, photo, idToken, null, serverAuthCode, null, null)
            } else {
                nativeOnLoginError("unknown", "No session")
            }
        }
    }

    private fun extractJsonValue(json: String, key: String): String? {
        val pattern = "\"$key\":\"([^\"]*)\""
        val regex = Regex(pattern)
        return regex.find(json)?.groupValues?.get(1)
    }

    private fun saveUser(context: Context, provider: String, email: String?, name: String?, 
                          photo: String?, idToken: String?, serverAuthCode: String?, scopes: List<String>?) {
        val pref = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val json = StringBuilder()
        json.append("{")
        json.append("\"provider\":\"$provider\"")
        if (email != null) json.append(",\"email\":\"$email\"")
        if (name != null) json.append(",\"name\":\"$name\"")
        if (photo != null) json.append(",\"photo\":\"$photo\"")
        if (idToken != null) json.append(",\"idToken\":\"$idToken\"")
        if (serverAuthCode != null) json.append(",\"serverAuthCode\":\"$serverAuthCode\"")
        if (scopes != null) {
            json.append(",\"scopes\":[")
            json.append(scopes.joinToString(",") { "\"$it\"" })
            json.append("]")
        }
        json.append("}")
        pref.edit().putString("user_json", json.toString()).apply()
    }
}

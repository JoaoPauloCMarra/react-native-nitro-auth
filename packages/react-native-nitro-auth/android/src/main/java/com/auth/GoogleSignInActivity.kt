package com.auth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.api.signin.GoogleSignIn
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
        
        fun createIntent(context: Context, clientId: String, scopes: Array<String>, loginHint: String?, forcePicker: Boolean = false): Intent {
            return Intent(context, GoogleSignInActivity::class.java).apply {
                putExtra(EXTRA_CLIENT_ID, clientId)
                putExtra(EXTRA_SCOPES, scopes)
                putExtra(EXTRA_LOGIN_HINT, loginHint)
                putExtra(EXTRA_FORCE_PICKER, forcePicker)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
    }
    
    private val signInLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        try {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            val account = task.getResult(ApiException::class.java)
            val scopes = intent.getStringArrayExtra(EXTRA_SCOPES)?.toList() ?: emptyList()
            AuthAdapter.onSignInSuccess(account, scopes)
        } catch (e: ApiException) {
            AuthAdapter.onSignInError(e.statusCode, e.message)
        }
        finish()
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val clientId = intent.getStringExtra(EXTRA_CLIENT_ID)
        val scopes = intent.getStringArrayExtra(EXTRA_SCOPES) ?: arrayOf("email", "profile")
        val loginHint = intent.getStringExtra(EXTRA_LOGIN_HINT)
        val forcePicker = intent.getBooleanExtra(EXTRA_FORCE_PICKER, false)
        
        if (clientId == null) {
            AuthAdapter.onSignInError(8, "Missing client ID")
            finish()
            return
        }
        
        val gsoBuilder = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(clientId)
            .requestServerAuthCode(clientId)
            .requestEmail()
        
        scopes.forEach { scopeStr ->
            if (scopeStr != "email" && scopeStr != "profile" && scopeStr != "openid") {
                gsoBuilder.requestScopes(Scope(scopeStr))
            }
        }
        
        // Only set account name if not forcing picker
        if (!forcePicker && loginHint != null) {
            gsoBuilder.setAccountName(loginHint)
        }
        
        val client = GoogleSignIn.getClient(this, gsoBuilder.build())
        
        if (forcePicker) {
            // Sign out first to ensure account picker shows all accounts
            client.signOut().addOnCompleteListener {
                signInLauncher.launch(client.signInIntent)
            }
        } else {
            signInLauncher.launch(client.signInIntent)
        }
    }
}


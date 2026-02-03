package com.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class MicrosoftAuthActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let { handleIntent(it) }
    }

    private fun handleIntent(intent: Intent) {
        val uri = intent.data
        if (uri != null && uri.scheme?.startsWith("msauth") == true) {
            AuthAdapter.handleMicrosoftRedirect(uri)
        }
        finish()
    }
}

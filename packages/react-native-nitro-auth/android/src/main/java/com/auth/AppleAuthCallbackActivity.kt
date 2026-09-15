package com.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Receives an opaque broker attempt id. Provider credentials stay on HTTPS requests. */
class AppleAuthCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let(::handleIntent)
    }

    private fun handleIntent(intent: Intent) {
        returnToAppAfterAppleCallback(this, intent.data?.let(AuthAdapter::handleAppleRedirect) == true)
    }
}

internal fun returnToAppAfterAppleCallback(activity: Activity, accepted: Boolean) {
    if (accepted) {
        activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.let { launcher ->
            launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            activity.startActivity(launcher)
        }
    }
    activity.finish()
}

package com.auth

import android.content.Context

/**
 * Durable Google session preferences. Every function is a pure Context -> disk
 * operation and takes no locks; callers own the `AuthAdapter` monitor and must
 * already hold it when invoking the `*Locked` helpers.
 */
internal object GoogleSessionStore {
    private const val GOOGLE_STATE_PREFERENCES = "nitro_auth_google_state"
    private const val GOOGLE_STATE_KIND = "kind"
    private const val GOOGLE_STATE_ACCOUNT_ID = "account_id"
    private const val GOOGLE_STATE_HOSTED_DOMAIN = "hosted_domain"

    fun restore(context: Context): GoogleSessionState {
        val preferences = context.getSharedPreferences(GOOGLE_STATE_PREFERENCES, Context.MODE_PRIVATE)
        return restoreGoogleSessionState(
            persistedKind = preferences.getString(GOOGLE_STATE_KIND, null),
            persistedAccountId = preferences.getString(GOOGLE_STATE_ACCOUNT_ID, null),
            persistedHostedDomain = preferences.getString(GOOGLE_STATE_HOSTED_DOMAIN, null),
        )
    }

    fun persistLocked(context: Context, state: GoogleSessionState) {
        val editor = context.getSharedPreferences(GOOGLE_STATE_PREFERENCES, Context.MODE_PRIVATE).edit()
            .putString(
                GOOGLE_STATE_KIND,
                state.persistedKind(),
            )
        if (state.accountId.isNullOrEmpty()) {
            editor.remove(GOOGLE_STATE_ACCOUNT_ID)
        } else {
            editor.putString(GOOGLE_STATE_ACCOUNT_ID, state.accountId)
        }
        if (state.requestedHostedDomain == null) {
            editor.remove(GOOGLE_STATE_HOSTED_DOMAIN)
        } else {
            editor.putString(GOOGLE_STATE_HOSTED_DOMAIN, state.requestedHostedDomain)
        }
        editor.commit()
    }

    fun clearLocked(context: Context) {
        context.getSharedPreferences(GOOGLE_STATE_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }
}

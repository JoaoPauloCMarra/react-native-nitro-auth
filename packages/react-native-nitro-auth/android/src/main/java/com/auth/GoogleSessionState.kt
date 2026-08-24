package com.auth

internal enum class GoogleSessionKind {
    NONE,
    LEGACY,
    MODERN,
}

internal data class GoogleSessionState(
    val requestedHostedDomain: String?,
    val accountId: String? = null,
    val kind: GoogleSessionKind = GoogleSessionKind.NONE,
) {
    fun returnedHostedDomain(restoredAccountId: String? = null): String? {
        if (restoredAccountId != null && accountId != restoredAccountId) {
            return null
        }
        return requestedHostedDomain
    }

    fun returnedHostedDomainForAccount(restoredAccountId: String?): String? {
        if (accountId == null || restoredAccountId == null || accountId != restoredAccountId) {
            return null
        }
        return requestedHostedDomain
    }
}

internal fun restoreGoogleSessionState(
    persistedKind: String?,
    persistedAccountId: String?,
    persistedHostedDomain: String?,
): GoogleSessionState = GoogleSessionState(
    requestedHostedDomain = persistedHostedDomain,
    accountId = persistedAccountId,
    kind = when (persistedKind) {
        "legacy" -> GoogleSessionKind.LEGACY
        "modern" -> GoogleSessionKind.MODERN
        else -> GoogleSessionKind.NONE
    },
)

internal fun GoogleSessionState.persistedKind(): String = when (kind) {
    GoogleSessionKind.LEGACY -> "legacy"
    GoogleSessionKind.MODERN -> "modern"
    GoogleSessionKind.NONE -> "none"
}

internal fun isLegacyGoogleRevokeEligible(
    sessionKind: GoogleSessionKind,
    hasTrackedLegacySession: Boolean,
    providerSdkHasAccount: Boolean,
): Boolean =
    sessionKind != GoogleSessionKind.MODERN &&
        (hasTrackedLegacySession || providerSdkHasAccount)

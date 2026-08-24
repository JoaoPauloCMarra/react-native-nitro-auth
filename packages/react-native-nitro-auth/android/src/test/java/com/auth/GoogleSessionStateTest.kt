package com.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GoogleSessionStateTest {

    @Test
    fun returnedHostedDomainIsTheRequestedConfiguration() {
        assertEquals(
            "company.example",
            GoogleSessionState("company.example").returnedHostedDomain(),
        )
    }

    @Test
    fun missingConfigurationDoesNotInferAHostedDomain() {
        assertNull(GoogleSessionState(null).returnedHostedDomain())
    }

    @Test
    fun restoredHostedDomainIsScopedToTheSameAccount() {
        val state = GoogleSessionState(
            requestedHostedDomain = "company.example",
            accountId = "account-a",
            kind = GoogleSessionKind.LEGACY,
        )
        assertEquals("company.example", state.returnedHostedDomain("account-a"))
        assertNull(state.returnedHostedDomain("account-b"))
        assertNull(state.returnedHostedDomainForAccount(null))
    }

    @Test
    fun modernSessionIsNotLegacyRevokeEligible() {
        assertEquals(GoogleSessionKind.MODERN, GoogleSessionState("company.example", kind = GoogleSessionKind.MODERN).kind)
    }

    @Test
    fun durableStateRoundTripsAcrossModuleRecreation() {
        val restored = restoreGoogleSessionState(
            persistedKind = "legacy",
            persistedAccountId = "account-a",
            persistedHostedDomain = "company.example",
        )
        assertEquals(GoogleSessionKind.LEGACY, restored.kind)
        assertEquals("company.example", restored.returnedHostedDomainForAccount("account-a"))
        assertEquals("legacy", restored.persistedKind())
    }

    @Test
    fun modernLoginRetiresLegacyRevokeEligibility() {
        assertEquals(
            false,
            isLegacyGoogleRevokeEligible(
                sessionKind = GoogleSessionKind.MODERN,
                hasTrackedLegacySession = true,
                providerSdkHasAccount = true,
            ),
        )
        assertEquals(
            true,
            isLegacyGoogleRevokeEligible(
                sessionKind = GoogleSessionKind.LEGACY,
                hasTrackedLegacySession = true,
                providerSdkHasAccount = false,
            ),
        )
    }
}

package com.auth

import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CredentialManagerRefreshRequestTest {

    private fun request(hostedDomain: String? = null): GetCredentialRequest =
        AuthAdapter.buildCredentialManagerRefreshRequest("client.apps.googleusercontent.com", hostedDomain)

    @Test
    fun refreshOnlyUsesImmediatelyAvailableCredentials() {
        assertTrue(request().preferImmediatelyAvailableCredentials)
        assertTrue(request("company.example").preferImmediatelyAvailableCredentials)
    }

    @Test
    fun refreshRequestsExactlyOneGoogleIdTokenOption() {
        val options = request().credentialOptions
        assertEquals(1, options.size)
        assertEquals(GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL, options.first().type)
    }
}

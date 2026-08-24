package com.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GooglePickerOperationStateTest {

    @Test
    fun cancellationInvalidatesAQueuedSignOutBeforeLaunchClaim() {
        val state = GooglePickerOperationState()
        val activity = Any()

        state.register(activity, "login", 11L, 4L)

        assertNotNull(state.invalidate())
        assertFalse(state.claimLaunch(activity, "login", 11L, 4L))
    }

    @Test
    fun aClaimIsOwnedByOneActivityGenerationAndCannotBeReused() {
        val state = GooglePickerOperationState()
        val activity = Any()

        state.register(activity, "login", 11L, 4L)

        assertTrue(state.claimLaunch(activity, "login", 11L, 4L))
        assertFalse(state.claimLaunch(activity, "login", 11L, 4L))
        assertFalse(state.claimLaunch(Any(), "login", 11L, 4L))
    }

    @Test
    fun recreationReplacesTheOldActivityWithoutAllowingTheOldOneToUnregisterIt() {
        val state = GooglePickerOperationState()
        val oldActivity = Any()
        val newActivity = Any()

        state.register(oldActivity, "login", 11L, 4L)
        state.register(newActivity, "login", 11L, 4L)
        state.unregister(oldActivity, "login", 11L)

        assertTrue(state.isActive("login", 11L))
        assertTrue(state.claimLaunch(newActivity, "login", 11L, 4L))
    }

    @Test
    fun restoreRejectsAnSdkAccountWhileItsPickerGenerationNeedsRevalidation() {
        assertFalse(
            isOwnedLegacyGoogleAccount(
                sessionKind = GoogleSessionKind.LEGACY,
                persistedAccountId = "account-a",
                providerAccountId = "account-a",
                needsRevalidation = true,
            ),
        )
        assertTrue(
            isOwnedLegacyGoogleAccount(
                sessionKind = GoogleSessionKind.LEGACY,
                persistedAccountId = "account-a",
                providerAccountId = "account-a",
                needsRevalidation = false,
            ),
        )
    }

    @Test
    fun stalePickerResultIsCleanedOnlyBeforeAReplacementSessionOwnsTheSdkAccount() {
        assertTrue(
            shouldCleanupStaleGooglePickerAccount(
                needsRevalidation = true,
                loginPending = false,
                scopesPending = false,
                sessionKind = GoogleSessionKind.NONE,
                hasOneTapSession = false,
                hasMicrosoftRefreshToken = false,
            ),
        )
        assertFalse(
            shouldCleanupStaleGooglePickerAccount(
                needsRevalidation = true,
                loginPending = true,
                scopesPending = false,
                sessionKind = GoogleSessionKind.NONE,
                hasOneTapSession = false,
                hasMicrosoftRefreshToken = false,
            ),
        )
        assertFalse(
            shouldCleanupStaleGooglePickerAccount(
                needsRevalidation = true,
                loginPending = false,
                scopesPending = false,
                sessionKind = GoogleSessionKind.LEGACY,
                hasOneTapSession = false,
                hasMicrosoftRefreshToken = false,
            ),
        )
    }
}

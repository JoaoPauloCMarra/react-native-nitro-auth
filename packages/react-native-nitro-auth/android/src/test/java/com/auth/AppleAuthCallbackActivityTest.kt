package com.auth

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class AppleAuthCallbackActivityTest {
    @Test
    fun acceptedCallbackReturnsToAppTaskWithoutForwardingCallbackData() {
        val activity = Robolectric.buildActivity(Activity::class.java).create().get()
        val launcherQuery = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(activity.packageName)
        val resolved = ResolveInfo().apply {
            activityInfo = ActivityInfo().apply {
                name = "com.example.MainActivity"
                packageName = activity.packageName
                applicationInfo = ApplicationInfo().apply { packageName = activity.packageName }
            }
        }
        shadowOf(activity.packageManager).addResolveInfoForIntent(launcherQuery, resolved)

        returnToAppAfterAppleCallback(activity, true)

        val launched = shadowOf(activity).nextStartedActivity
        assertEquals("com.example.MainActivity", launched.component?.className)
        assertTrue(launched.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertTrue(launched.flags and Intent.FLAG_ACTIVITY_CLEAR_TOP != 0)
        assertTrue(launched.flags and Intent.FLAG_ACTIVITY_SINGLE_TOP != 0)
        assertNull(launched.data)
        assertTrue(launched.extras == null || launched.extras!!.isEmpty)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun unacceptedCallbackCannotLaunchTheApp() {
        val activity = Robolectric.buildActivity(Activity::class.java).create().get()
        assertFalse(activity.isFinishing)
        returnToAppAfterAppleCallback(activity, false)
        assertNull(shadowOf(activity).nextStartedActivity)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun missingLauncherStillFinishesTheCallback() {
        val activity = Robolectric.buildActivity(Activity::class.java).create().get()
        returnToAppAfterAppleCallback(activity, true)
        assertTrue(activity.isFinishing)
    }
}

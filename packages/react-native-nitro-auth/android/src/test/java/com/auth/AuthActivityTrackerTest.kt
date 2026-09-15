package com.auth

import android.app.Activity
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class AuthActivityTrackerTest {
    @Test
    fun lateInitializationSeedsTheAlreadyResumedHostActivity() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val tracker = AuthActivityTracker()

        tracker.seed(activity)

        assertSame(activity, tracker.currentActivity())
        controller.pause()
        tracker.onActivityPaused(activity)
        assertNull(tracker.currentActivity())
        controller.destroy()
    }

    @Test
    fun destroyedActivityIsNotSeeded() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        controller.destroy()
        val tracker = AuthActivityTracker()

        tracker.seed(activity)

        assertNull(tracker.currentActivity())
    }

    @Test
    fun destroyingAnOlderActivityDoesNotClearTheCurrentHost() {
        val oldController = Robolectric.buildActivity(Activity::class.java).setup()
        val oldActivity = oldController.get()
        val currentController = Robolectric.buildActivity(Activity::class.java).setup()
        val currentActivity = currentController.get()
        val tracker = AuthActivityTracker()

        tracker.seed(oldActivity)
        tracker.onActivityResumed(currentActivity)
        tracker.onActivityDestroyed(oldActivity)

        assertSame(currentActivity, tracker.currentActivity())
        oldController.destroy()
        currentController.destroy()
    }

    @Test
    fun aNewerResumeWinsOverTheInitializationSnapshot() {
        val oldController = Robolectric.buildActivity(Activity::class.java).setup()
        val newController = Robolectric.buildActivity(Activity::class.java).setup()
        val tracker = AuthActivityTracker()
        tracker.onActivityResumed(newController.get())
        tracker.seed(oldController.get())
        assertSame(newController.get(), tracker.currentActivity())
        oldController.destroy()
        newController.destroy()
    }

    @Test
    fun pauseBeforeTheSeedDoesNotRestoreTheOldActivity() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val tracker = AuthActivityTracker()
        tracker.onActivityPaused(controller.get())
        tracker.seed(controller.get())
        assertNull(tracker.currentActivity())
        controller.destroy()
    }

    @Test
    fun finishingActivityIsNeverReturned() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val tracker = AuthActivityTracker()
        tracker.seed(controller.get())
        controller.get().finish()
        assertNull(tracker.currentActivity())
        tracker.seed(controller.get())
        assertNull(tracker.currentActivity())
        controller.destroy()
    }
}

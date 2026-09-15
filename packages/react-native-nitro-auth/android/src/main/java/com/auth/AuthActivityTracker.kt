package com.auth

import android.app.Activity

/** Tracks the current host Activity, including when initialized after its first resume. */
internal class AuthActivityTracker {
    @Volatile
    private var activity: Activity? = null
    private var lifecycleEventObserved = false

    @Synchronized
    fun currentActivity(): Activity? {
        val current = activity ?: return null
        if (current.isFinishing || current.isDestroyed) {
            activity = null
            return null
        }
        return current
    }

    @Synchronized
    fun seed(activity: Activity?) {
        if (!lifecycleEventObserved) setIfUsable(activity)
    }

    @Synchronized
    fun onActivityCreated(activity: Activity) = observeAvailable(activity)

    @Synchronized
    fun onActivityStarted(activity: Activity) = observeAvailable(activity)

    @Synchronized
    fun onActivityResumed(activity: Activity) = observeAvailable(activity)

    @Synchronized
    fun onActivityPaused(activity: Activity) = observeUnavailable(activity)

    @Synchronized
    fun onActivityStopped(activity: Activity) = observeUnavailable(activity)

    @Synchronized
    fun onActivityDestroyed(activity: Activity) = observeUnavailable(activity)

    @Synchronized
    fun clear() {
        activity = null
        lifecycleEventObserved = false
    }

    private fun observeAvailable(candidate: Activity) {
        lifecycleEventObserved = true
        setIfUsable(candidate)
    }

    private fun observeUnavailable(candidate: Activity) {
        lifecycleEventObserved = true
        clearIfCurrent(candidate)
    }

    private fun setIfUsable(candidate: Activity?) {
        if (candidate == null) return
        if (candidate.isFinishing || candidate.isDestroyed) {
            clearIfCurrent(candidate)
            return
        }
        activity = candidate
    }

    private fun clearIfCurrent(candidate: Activity) {
        if (activity === candidate) activity = null
    }
}

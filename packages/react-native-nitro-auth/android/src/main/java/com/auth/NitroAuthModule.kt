package com.auth

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.margelo.nitro.com.auth.NitroAuthOnLoad

class NitroAuthModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "NitroAuthModule"

    init {
        try {
            // Load the native library first so that AuthAdapter's JNI methods are resolvable.
            NitroAuthOnLoad.initializeNative()
            AuthAdapter.initialize(reactContext)
            Log.d("NitroAuthModule", "NitroAuth initialized")
        } catch (e: Exception) {
            Log.e("NitroAuthModule", "Failed to initialize NitroAuth", e)
        }
    }

    override fun invalidate() {
        super.invalidate()
        AuthAdapter.dispose()
    }
}

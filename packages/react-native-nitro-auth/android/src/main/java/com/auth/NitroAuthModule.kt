package com.auth

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import com.margelo.nitro.com.auth.NitroAuthOnLoad

class NitroAuthModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), TurboModule {
    override fun getName(): String = NAME

    init {
        try {
            // Load the native library first so that AuthAdapter's JNI methods are resolvable.
            NitroAuthOnLoad.initializeNative()
            AuthAdapter.initialize(reactContext)
            Log.d("NitroAuthModule", "NitroAuth initialized")
        } catch (error: Throwable) {
            Log.e("NitroAuthModule", "Failed to initialize NitroAuth", error)
            throw IllegalStateException("configuration_error", error)
        }
    }

    override fun invalidate() {
        super.invalidate()
        AuthAdapter.dispose()
    }

    companion object {
        const val NAME = "NitroAuthModule"
    }
}

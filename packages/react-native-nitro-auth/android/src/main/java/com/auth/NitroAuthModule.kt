package com.auth

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class NitroAuthModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "NitroAuthModule"

    init {
        try {
            AuthAdapter.initialize(reactContext)
            com.margelo.nitro.com.auth.NitroAuthOnLoad.initializeNative()
            Log.d("NitroAuthModule", "NitroAuth initialized")
        } catch (e: Exception) {
            Log.e("NitroAuthModule", "Failed to initialize NitroAuth", e)
        }
    }
}

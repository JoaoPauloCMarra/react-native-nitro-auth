package com.auth

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NitroAuthPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == NitroAuthModule.NAME) {
            NitroAuthModule(reactContext)
        } else {
            null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                NitroAuthModule.NAME to ReactModuleInfo(
                    NitroAuthModule.NAME,
                    NitroAuthModule::class.java.name,
                    false,
                    true,
                    false,
                    BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
                ),
            )
        }
    }
}

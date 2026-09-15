package com.auth

import com.facebook.react.BaseReactPackage
import com.facebook.react.ReactPackage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NitroAuthPackageTest {
    @Test
    fun registersAuthModuleForEagerInitialization() {
        val reactPackage: ReactPackage = NitroAuthPackage()
        assertTrue(
            "NitroAuthPackage must provide BaseReactPackage module metadata",
            reactPackage is BaseReactPackage,
        )

        val provider = (reactPackage as? BaseReactPackage)?.getReactModuleInfoProvider()
        assertNotNull("BaseReactPackage must expose its module metadata", provider)

        val moduleInfo = provider?.getReactModuleInfos()?.get(NitroAuthModule.NAME)
        assertNotNull("NitroAuthModule must be registered", moduleInfo)
        assertEquals(NitroAuthModule.NAME, moduleInfo?.name)
        assertEquals(NitroAuthModule::class.java.name, moduleInfo?.className)
        assertTrue(
            "HybridObject registration must run during module initialization",
            moduleInfo?.needsEagerInit == true,
        )
        assertEquals(BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, moduleInfo?.isTurboModule)
    }
}

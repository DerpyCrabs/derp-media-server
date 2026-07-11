package com.derpmedia.app

import android.Manifest
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DownloadPermissionFlowTest {
    @Test fun permissionRequestFromWebMessageDoesNotCrashApp() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        device.executeShellCommand(
            "pm clear-permission-flags ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS} user-set user-fixed",
        )
        instrumentation.uiAutomation.revokeRuntimePermission(
            context.packageName,
            Manifest.permission.POST_NOTIFICATIONS,
        )
        context.getSharedPreferences("connection", 0).edit()
            .putString("url", "https://localhost:3102")
            .commit()

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            Thread.sleep(2500)
            scenario.onActivity { activity ->
                activity.webViewForTest().evaluateJavascript(
                    """DerpAndroid.postMessage(JSON.stringify({type:'download',name:'probe.txt',path:'probe.txt',isDirectory:false,mediaUrl:'https://localhost:3102/api/media/probe.txt',downloadUrl:'https://localhost:3102/api/files/download?path=probe.txt',listUrl:null,mediaBaseUrl:'https://localhost:3102/api/media/'}))""",
                    null,
                )
            }

            val allow = device.wait(Until.findObject(By.text("Allow")), 5_000)
            assertNotNull("Notification permission dialog did not appear", allow)
            allow.click()
            device.waitForIdle()
            Thread.sleep(1000)

            scenario.onActivity { activity ->
                assertTrue("MainActivity should remain alive", !activity.isFinishing && !activity.isDestroyed)
            }
        }
    }
}

package com.derpmedia.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OfflinePreflightTest {
    @Test fun loadsCachedOfflineNavigationWithoutStartingUnreachableServerRequest() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val origin = "https://10.255.255.1"
        context.getSharedPreferences("connection", 0).edit()
            .putString("url", origin)
            .putBoolean("offlineShell:$origin", true)
            .commit()
        OfflineStore.deletePath(context, "Offline")
        OfflineStore.markDirectory(context, "Offline", "Offline")

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            Thread.sleep(3_000)
            scenario.onActivity { activity ->
                assertTrue(activity.webViewForTest().url.orEmpty().contains("?offline=1"))
            }
        }

        OfflineStore.deletePath(context, "Offline")
    }
}

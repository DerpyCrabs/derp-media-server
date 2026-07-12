package com.derpmedia.app

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage

@RunWith(AndroidJUnit4::class)
class ColdOfflineWebViewTest {
    @Test fun cachedWebInterfaceOpensNativeOfflineFileWithoutServer() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val origin = "https://localhost:3102"
        context.getSharedPreferences("connection", 0).edit().putString("url", origin).commit()
        OfflineStore.deletePath(context, "Media")
        OfflineStore.markDirectory(context, "Media", "Media")
        val url = "$origin/api/media/Media/readme.txt"
        val file = OfflineStore.file(context, url).apply { writeText("Cold offline content") }
        OfflineStore.markComplete(file, url, "readme.txt", "text", "Media/readme.txt")
        val videoUrl = "$origin/api/media/Media/video.mp4"
        val video = OfflineStore.file(context, videoUrl).apply { writeBytes(ByteArray(128)) }
        OfflineStore.markComplete(video, videoUrl, "video.mp4", "video", "Media/video.mp4")

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var state = ""
            repeat(40) {
                state = evaluate(
                    scenario,
                    "JSON.stringify({secure:window.isSecureContext,sw:'serviceWorker' in navigator,controller:!!navigator.serviceWorker?.controller,href:location.href})",
                )
                if (state.contains("\\\"controller\\\":true")) return@repeat
                Thread.sleep(250)
            }
            if (!state.contains("\\\"controller\\\":true")) {
                scenario.onActivity { it.webViewForTest().reload() }
                Thread.sleep(2_000)
                state = evaluate(
                    scenario,
                    "JSON.stringify({secure:window.isSecureContext,sw:'serviceWorker' in navigator,controller:!!navigator.serviceWorker?.controller,href:location.href})",
                )
            }
            assertTrue("Service worker did not control WebView: $state", state.contains("\\\"controller\\\":true"))
            scenario.onActivity { it.webViewForTest().reload() }
            assertBodyContains(scenario, "Media")
            Thread.sleep(1_000)
        }

        val intent = Intent(context, MainActivity::class.java)
            .putExtra("simulateOfflineForTest", true)
            .putExtra("offline", true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            assertBodyContains(scenario, "Offline")
            clickPath(scenario, "Media")
            assertBodyContains(scenario, "readme.txt")
            clickPath(scenario, "Media/readme.txt")
            assertBodyContains(scenario, "Cold offline content")
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            assertBodyContains(scenario, "video.mp4")
            clickPath(scenario, "Media/video.mp4")
            var playerOpened = false
            repeat(20) {
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    playerOpened = ActivityLifecycleMonitorRegistry.getInstance()
                        .getActivitiesInStage(Stage.RESUMED)
                        .any { it is PlayerActivity }
                }
                if (!playerOpened) Thread.sleep(250)
            }
            assertTrue("Offline video did not open in PlayerActivity", playerOpened)
        }

        OfflineStore.deletePath(context, "Media")
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val result = arrayOf("")
        val latch = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.webViewForTest().evaluateJavascript(script) {
                result[0] = it
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        return result[0]
    }

    private fun assertBodyContains(scenario: ActivityScenario<MainActivity>, expected: String) {
        val result = arrayOfNulls<String>(1)
        repeat(30) {
            val latch = CountDownLatch(1)
            scenario.onActivity { activity ->
                activity.webViewForTest().evaluateJavascript("document.body.innerText") {
                    result[0] = it
                    latch.countDown()
                }
            }
            latch.await(2, TimeUnit.SECONDS)
            if (result[0]?.contains(expected) == true) return
            Thread.sleep(250)
        }
        assertTrue("Expected WebView body to contain $expected, got ${result[0]}", false)
    }

    private fun clickPath(scenario: ActivityScenario<MainActivity>, path: String) {
        val latch = CountDownLatch(1)
        scenario.onActivity { activity ->
            val encoded = org.json.JSONObject.quote(path)
            activity.webViewForTest().evaluateJavascript(
                "Array.from(document.querySelectorAll('[data-file-path]')).find(el=>el.getAttribute('data-file-path')===$encoded)?.click()",
            ) { latch.countDown() }
        }
        latch.await(2, TimeUnit.SECONDS)
    }
}

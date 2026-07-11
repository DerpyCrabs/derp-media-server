package com.derpmedia.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import android.net.Uri
import android.webkit.WebResourceRequest
import androidx.test.core.app.ActivityScenario

@RunWith(AndroidJUnit4::class)
class OfflineStoreTest {
    @Test fun completedFileRequiresMarkerAndStoresMetadata() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val url = "https://media.test/api/media/Music/track.flac"
        val file = OfflineStore.file(context, url)
        file.parentFile?.deleteRecursively()
        file.parentFile?.mkdirs()
        file.writeBytes(byteArrayOf(1, 2, 3))
        assertNull(OfflineStore.completed(context, url))

        OfflineStore.markComplete(file, url, "track.flac", "audio", "Media/Music/track.flac")

        assertEquals(file, OfflineStore.completed(context, url))
        val metadata = JSONObject(java.io.File(file.path + ".json").readText())
        assertEquals(url, metadata.getString("url"))
        assertEquals("track.flac", metadata.getString("title"))
        assertEquals("audio", metadata.getString("mediaType"))
        assertEquals("Media/Music/track.flac", metadata.getString("path"))
        assertTrue(java.io.File(file.path + ".complete").isFile)
    }

    @Test fun storesDirectoriesAndFullLogicalPaths() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.filesDir, "offline").deleteRecursively()
        OfflineStore.markDirectory(context, "Media/Logs", "Logs")
        OfflineStore.markDirectory(context, "Media/Logs/Archive", "Archive")

        val paths = OfflineStore.entries(context).map { it.path }.toSet()
        assertEquals(setOf("Media/Logs", "Media/Logs/Archive"), paths)
        assertTrue(OfflineStore.entries(context).all { it.isDirectory })
    }

    @Test fun deletingDirectoryRemovesItsEntireOfflineSubtree() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.filesDir, "offline").deleteRecursively()
        OfflineStore.markDirectory(context, "Media/Logs", "Logs")
        val url = "https://media.test/api/media/Media/Logs/app.log"
        val file = OfflineStore.file(context, url).apply { parentFile?.mkdirs(); writeText("log") }
        OfflineStore.markComplete(file, url, "app.log", "text", "Media/Logs/app.log")
        OfflineStore.markDirectory(context, "Media/Keep", "Keep")

        OfflineStore.deletePath(context, "Media/Logs")

        assertEquals(listOf("Media/Keep"), OfflineStore.entries(context).map { it.path })
        assertTrue(!file.exists())
    }

    @Test fun localMediaResponseSupportsByteRanges() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.filesDir, "offline").deleteRecursively()
        context.getSharedPreferences("connection", 0).edit().clear().commit()
        val url = "https://media.test/api/media/Media/video.mp4"
        val file = OfflineStore.file(context, url).apply {
            parentFile?.mkdirs()
            writeBytes(ByteArray(32) { it.toByte() })
        }
        OfflineStore.markComplete(file, url, "video.mp4", "video", "Media/video.mp4")
        val request = object : WebResourceRequest {
            override fun getUrl() = Uri.parse(url)
            override fun isForMainFrame() = false
            override fun isRedirect() = false
            override fun hasGesture() = false
            override fun getMethod() = "GET"
            override fun getRequestHeaders() = mapOf("Range" to "bytes=4-11")
        }

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val response = activity.offlineResponseForTest(request)!!
                assertEquals(206, response.statusCode)
                assertEquals("bytes 4-11/32", response.responseHeaders["Content-Range"])
                assertEquals((4..11).map(Int::toByte), response.data.readBytes().toList())
            }
        }
    }
}

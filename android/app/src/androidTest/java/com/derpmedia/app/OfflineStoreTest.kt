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
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.WebResourceRequest
import androidx.test.core.app.ActivityScenario

@RunWith(AndroidJUnit4::class)
class OfflineStoreTest {
    @Test fun generatesLocalVideoThumbnail() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.filesDir, "offline").deleteRecursively()
        val source = java.io.File(context.cacheDir, "thumbnail-source.mp4")
        source.writeBytes(Base64.decode(TEST_VIDEO_BASE64, Base64.DEFAULT))
        val thumbnail = java.io.File(context.cacheDir, "thumbnail-result.jpg")

        assertTrue(OfflineThumbnailGenerator.generate(source, "video", thumbnail))
        val decoded = BitmapFactory.decodeFile(thumbnail.path)
        assertTrue(decoded.width > 0 && decoded.height > 0)
        decoded.recycle()
        source.delete()
        thumbnail.delete()
    }

    @Test fun generatesAndDeletesLocalImageThumbnail() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(context.filesDir, "offline").deleteRecursively()
        val url = "https://media.test/api/media/Images/photo.png"
        val file = OfflineStore.file(context, url).apply {
            parentFile?.mkdirs()
            Bitmap.createBitmap(900, 600, Bitmap.Config.ARGB_8888).also { bitmap ->
                outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
        }
        val thumbnailUrl = "offline-thumbnail:$url"
        val thumbnail = OfflineStore.thumbnailFile(context, thumbnailUrl)
        assertTrue(OfflineThumbnailGenerator.generate(file, "image", thumbnail))
        OfflineStore.markComplete(file, url, "photo.png", "image", "Images/photo.png", thumbnailUrl)

        val decoded = BitmapFactory.decodeFile(thumbnail.path)
        assertEquals(480, maxOf(decoded.width, decoded.height))
        decoded.recycle()
        assertEquals(thumbnail, OfflineStore.entries(context).single().thumbnailFile)

        OfflineStore.deletePath(context, "Images/photo.png")
        assertTrue(!thumbnail.exists())
        assertTrue(OfflineStore.entries(context).isEmpty())
    }

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

private const val TEST_VIDEO_BASE64 = "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"

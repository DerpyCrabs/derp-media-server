package com.derpmedia.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OfflineDownloadTransferTest {
    @Test fun resumesPartialDownloadWithRangeRequest() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val target = java.io.File(context.cacheDir, "resumed-offline.media")
        target.delete()
        java.io.File(target.path + ".part").writeBytes(byteArrayOf(0, 1, 2, 3))
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(206).setBody("\u0004\u0005\u0006\u0007\u0008\u0009"))
            server.start()

            OfflineDownloadTransfer.download(OkHttpClient(), server.url("/media").toString(), "session=test", target)

            val request = server.takeRequest()
            assertEquals("bytes=4-", request.headers["Range"])
            assertEquals("session=test", request.headers["Cookie"])
            assertArrayEquals(ByteArray(10) { it.toByte() }, target.readBytes())
        }
        target.delete()
    }
}

package com.derpmedia.app

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream

object OfflineDownloadTransfer {
    fun download(client: OkHttpClient, url: String, cookie: String, target: File) {
        val partial = File(target.path + ".part")
        val start = if (partial.isFile) partial.length() else 0L
        val request = Request.Builder().url(url).apply {
            if (cookie.isNotBlank()) header("Cookie", cookie)
            if (start > 0) header("Range", "bytes=$start-")
        }.build()
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Download failed: ${response.code}" }
            val append = start > 0 && response.code == 206
            response.body.byteStream().use { input ->
                FileOutputStream(partial, append).buffered().use { output -> input.copyTo(output) }
            }
        }
        if (target.exists()) target.delete()
        check(partial.renameTo(target))
    }
}

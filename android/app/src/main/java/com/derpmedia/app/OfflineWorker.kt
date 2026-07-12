package com.derpmedia.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import androidx.work.workDataOf
import java.net.URLEncoder

class OfflineWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val client = OkHttpClient.Builder().followRedirects(true).build()
    private val cookie = inputData.getString("cookie").orEmpty()
    private val touchedUrls = mutableSetOf<String>()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        setForeground(createForegroundInfo())
        runCatching {
            if (inputData.getBoolean("directory", false)) {
                syncDirectory(
                    inputData.getString("path").orEmpty(),
                    inputData.getString("displayPath").orEmpty(),
                )
            } else {
                download(
                    inputData.getString("sourceUrl").orEmpty(),
                    inputData.getString("name").orEmpty(),
                    inputData.getString("mediaType").orEmpty().ifBlank { "other" },
                    inputData.getString("displayPath").orEmpty(),
                    inputData.getString("thumbnailUrl").orEmpty(),
                )
            }
        }.fold({ Result.success() }, {
            if (runAttemptCount < 3) Result.retry()
            else {
                OfflineStore.deletePath(
                    applicationContext,
                    inputData.getString("displayPath").orEmpty(),
                )
                for (url in touchedUrls) {
                    val target = OfflineStore.file(applicationContext, url)
                    File(target.path + ".part").delete()
                }
                Result.failure()
            }
        })
    }

    private fun request(url: String) = Request.Builder().url(url).apply {
        if (cookie.isNotBlank()) header("Cookie", cookie)
    }

    private fun syncDirectory(root: String, displayRoot: String) {
        val queue = ArrayDeque<Pair<String, String>>()
        val rootTitle = inputData.getString("name").orEmpty()
        queue.add(root to displayRoot)
        var completed = 0
        while (queue.isNotEmpty()) {
            val (dir, displayDir) = queue.removeFirst()
            val listBase = inputData.getString("listUrl").orEmpty()
            val listUrl = listBase + URLEncoder.encode(dir, Charsets.UTF_8.name()).replace("+", "%20")
            client.newCall(request(listUrl).build()).execute().use { response ->
                check(response.isSuccessful) { "Listing failed: ${response.code}" }
                OfflineStore.markDirectory(
                    applicationContext,
                    displayDir,
                    if (displayDir == displayRoot) rootTitle else displayDir.substringAfterLast('/'),
                )
                val files = JSONObject(response.body.string()).getJSONArray("files")
                for (i in 0 until files.length()) {
                    val item = files.getJSONObject(i)
                    val child = listOf(dir.trim('/'), item.getString("name")).filter { it.isNotEmpty() }.joinToString("/")
                    val displayChild = listOf(displayDir.trim('/'), item.getString("name"))
                        .filter { it.isNotEmpty() }.joinToString("/")
                    if (item.optBoolean("isDirectory")) {
                        OfflineStore.markDirectory(applicationContext, displayChild, item.getString("name"))
                        queue.add(child to displayChild)
                    } else {
                        val base = inputData.getString("mediaBaseUrl").orEmpty()
                        val encoded = child.split('/').joinToString("/") { URLEncoder.encode(it, Charsets.UTF_8.name()).replace("+", "%20") }
                        val type = item.optString("type", "other")
                        val thumbnailBase = inputData.getString("thumbnailBaseUrl").orEmpty()
                        val thumbnailUrl = if (type == "image" || type == "video") thumbnailBase + encoded else ""
                        download(base + encoded, item.getString("name"), type, displayChild, thumbnailUrl)
                        completed++
                        setProgressAsync(workDataOf("completed" to completed))
                    }
                }
            }
        }
    }

    private fun download(url: String, title: String, mediaType: String, logicalPath: String, thumbnailUrl: String) {
        require(url.isNotBlank())
        touchedUrls.add(url)
        val target = OfflineStore.file(applicationContext, url)
        target.parentFile?.mkdirs()
        OfflineDownloadTransfer.download(client, url, cookie, target)
        var savedThumbnailUrl = if (mediaType == "image" || mediaType == "video") {
            "offline-thumbnail:$url"
        } else ""
        if (savedThumbnailUrl.isNotBlank()) {
            val localThumbnail = OfflineStore.thumbnailFile(applicationContext, savedThumbnailUrl)
            if (!OfflineThumbnailGenerator.generate(target, mediaType, localThumbnail)) savedThumbnailUrl = ""
        }
        if (savedThumbnailUrl.isBlank() && thumbnailUrl.isNotBlank()) {
            client.newCall(request(thumbnailUrl).build()).execute().use { response ->
                if (response.isSuccessful) {
                    val thumbnail = OfflineStore.thumbnailFile(applicationContext, thumbnailUrl)
                    response.body.byteStream().use { input ->
                        FileOutputStream(thumbnail).buffered().use { output -> input.copyTo(output) }
                    }
                    savedThumbnailUrl = thumbnailUrl
                }
            }
        }
        OfflineStore.markComplete(target, url, title, mediaType, logicalPath.ifBlank { title }, savedThumbnailUrl)
    }

    private fun createForegroundInfo(): ForegroundInfo {
        val channel = "offline_downloads"
        if (Build.VERSION.SDK_INT >= 26) {
            applicationContext.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(channel, "Offline downloads", NotificationManager.IMPORTANCE_LOW))
        }
        val pending = PendingIntent.getActivity(
            applicationContext,
            0,
            Intent(applicationContext, MainActivity::class.java).putExtra("offline", true),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(applicationContext, channel)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Derp Media")
            .setContentText("Saving files for offline access")
            .setOngoing(true).setContentIntent(pending).build()
        return ForegroundInfo(4001, notification, if (Build.VERSION.SDK_INT >= 29) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0)
    }
}

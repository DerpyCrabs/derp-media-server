package com.derpmedia.app

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

data class OfflineEntry(
    val path: String,
    val title: String,
    val mediaType: String,
    val url: String,
    val isDirectory: Boolean,
    val file: File?,
    val thumbnailUrl: String,
    val thumbnailFile: File?,
)

object OfflineStore {
    private fun key(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun directory(context: Context) = File(context.filesDir, "offline").apply { mkdirs() }

    fun file(context: Context, url: String): File = File(directory(context), "${key(url)}.media")
    fun thumbnailFile(context: Context, url: String): File = File(directory(context), "${key(url)}.thumbnail")

    fun completed(context: Context, url: String): File? =
        file(context, url).takeIf { it.isFile && File(it.path + ".complete").isFile }

    fun markComplete(
        file: File,
        url: String,
        title: String,
        mediaType: String,
        logicalPath: String,
        thumbnailUrl: String = "",
    ) {
        File(file.path + ".complete").writeText("ok")
        File(file.path + ".json").writeText(JSONObject().apply {
            put("url", url)
            put("title", title)
            put("path", logicalPath.replace('\\', '/'))
            put("mediaType", mediaType)
            put("isDirectory", false)
            put("thumbnailUrl", thumbnailUrl)
        }.toString())
    }

    fun markDirectory(context: Context, logicalPath: String, title: String) {
        val normalized = logicalPath.replace('\\', '/').trimEnd('/')
        File(directory(context), "${key("directory:$normalized")}.directory.json").writeText(
            JSONObject().apply {
                put("url", "")
                put("title", title)
                put("path", normalized)
                put("mediaType", "folder")
                put("isDirectory", true)
            }.toString(),
        )
    }

    fun entries(context: Context): List<OfflineEntry> = directory(context)
        .listFiles { file -> file.name.endsWith(".json") }
        ?.mapNotNull { metadata ->
            runCatching {
                val json = JSONObject(metadata.readText())
                if (!json.has("path")) return@runCatching null
                val isDirectory = json.optBoolean("isDirectory", metadata.name.endsWith(".directory.json"))
                val mediaFile = if (isDirectory) null else File(metadata.path.removeSuffix(".json"))
                if (!isDirectory && (mediaFile?.isFile != true || !File(mediaFile.path + ".complete").isFile)) {
                    return@runCatching null
                }
                val title = json.optString("title", "File")
                val thumbnailUrl = json.optString("thumbnailUrl", "")
                OfflineEntry(
                    path = json.getString("path").replace('\\', '/'),
                    title = title,
                    mediaType = json.optString("mediaType", "other"),
                    url = json.optString("url", ""),
                    isDirectory = isDirectory,
                    file = mediaFile,
                    thumbnailUrl = thumbnailUrl,
                    thumbnailFile = thumbnailUrl.takeIf { it.isNotBlank() }
                        ?.let { thumbnailFile(context, it).takeIf(File::isFile) },
                )
            }.getOrNull()
        } ?: emptyList()

    fun hasContent(context: Context): Boolean = entries(context).isNotEmpty()

    fun deletePath(context: Context, logicalPath: String) {
        val normalized = logicalPath.trim('/').replace('\\', '/')
        directory(context).listFiles { file -> file.name.endsWith(".json") }?.forEach { metadata ->
            val json = runCatching { JSONObject(metadata.readText()) }.getOrNull() ?: return@forEach
            val path = json.optString("path").trim('/').replace('\\', '/')
            if (path != normalized && !path.startsWith("$normalized/")) return@forEach
            if (!json.optBoolean("isDirectory")) {
                val media = File(metadata.path.removeSuffix(".json"))
                File(media.path + ".complete").delete()
                File(media.path + ".part").delete()
                media.delete()
                json.optString("thumbnailUrl").takeIf { it.isNotBlank() }
                    ?.let { thumbnailFile(context, it).delete() }
            }
            metadata.delete()
        }
    }
}

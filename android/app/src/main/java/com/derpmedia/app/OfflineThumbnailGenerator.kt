package com.derpmedia.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import java.io.File
import java.io.FileOutputStream

object OfflineThumbnailGenerator {
    private const val MAX_EDGE = 480

    fun generate(source: File, mediaType: String, target: File): Boolean = runCatching {
        val bitmap = when (mediaType) {
            "image" -> BitmapFactory.decodeFile(source.path)
            "video" -> MediaMetadataRetriever().run {
                try {
                    setDataSource(source.path)
                    getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                        ?: getFrameAtTime(0)
                } finally {
                    release()
                }
            }
            else -> null
        } ?: return false
        val thumbnail = scale(bitmap)
        target.parentFile?.mkdirs()
        FileOutputStream(target).use { output ->
            check(thumbnail.compress(Bitmap.CompressFormat.JPEG, 82, output))
        }
        if (thumbnail !== bitmap) thumbnail.recycle()
        bitmap.recycle()
        true
    }.getOrDefault(false)

    private fun scale(bitmap: Bitmap): Bitmap {
        val max = maxOf(bitmap.width, bitmap.height)
        if (max <= MAX_EDGE) return bitmap
        val ratio = MAX_EDGE.toFloat() / max
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * ratio).toInt().coerceAtLeast(1),
            (bitmap.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }
}

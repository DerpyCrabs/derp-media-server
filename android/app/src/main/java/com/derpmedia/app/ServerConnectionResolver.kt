package com.derpmedia.app

import java.net.HttpURLConnection
import java.net.URL

object ServerConnectionResolver {
    fun candidates(value: String): List<String> {
        val trimmed = value.trim().trimEnd('/')
        if (trimmed.isBlank()) return emptyList()
        val explicit = when {
            trimmed.startsWith("https://", ignoreCase = true) -> "https"
            trimmed.startsWith("http://", ignoreCase = true) -> "http"
            else -> null
        }
        val withoutScheme = trimmed.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        val schemes = if (explicit == null) listOf("https", "http") else listOf(explicit, if (explicit == "https") "http" else "https")
        return schemes.map { "$it://$withoutScheme" }
    }

    fun resolve(value: String): String? = candidates(value).firstOrNull(::isReachable)

    private fun isReachable(value: String): Boolean = runCatching {
        val connection = URL(value).openConnection() as HttpURLConnection
        connection.connectTimeout = 1_000
        connection.readTimeout = 1_000
        connection.instanceFollowRedirects = false
        connection.requestMethod = "GET"
        connection.setRequestProperty("Range", "bytes=0-0")
        try {
            connection.responseCode in 100..599
        } finally {
            connection.disconnect()
        }
    }.getOrDefault(false)
}

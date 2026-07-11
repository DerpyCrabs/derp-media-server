package com.derpmedia.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.SslErrorHandler
import android.net.http.SslError
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.os.Build
import android.util.Log
import android.content.pm.PackageManager
import android.content.pm.ApplicationInfo
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkInfo
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max
import org.json.JSONObject
import org.json.JSONArray
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.io.FilterInputStream
import java.net.URLConnection

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("connection", MODE_PRIVATE) }
    private var pendingDownload: String? = null
    private var offlineFallbackOpened = false
    private var openOfflineOnLoad = false
    private var simulateOfflineForTest = false
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        val raw = pendingDownload
        pendingDownload = null
        if (raw != null) enqueueDownload(JSONObject(raw))
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
        openOfflineOnLoad = intent.getBooleanExtra("offline", false)
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        simulateOfflineForTest = debuggable && intent.getBooleanExtra("simulateOfflineForTest", false)
        if (simulateOfflineForTest) openOfflineOnLoad = true
        val saved = prefs.getString("url", null)
        if (saved == null) showConnectionScreen() else showBrowser(saved)
    }

    private fun normalizeUrl(value: String): String {
        val trimmed = value.trim().trimEnd('/')
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "https://$trimmed"
    }

    private fun showConnectionScreen() {
        val root = LinearLayout(this).apply {
            id = R.id.connection_root
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            view.setPadding(48, 48 + max(bars.top, cutout.top), 48, 48 + max(bars.bottom, cutout.bottom))
            insets
        }
        root.addView(TextView(this).apply {
            id = R.id.connection_title
            text = "Derp Media"
            textSize = 26f
            setPadding(0, 0, 0, 28)
        })
        val input = EditText(this).apply {
            id = R.id.connection_input
            hint = "Server address or share link"
            setText(prefs.getString("url", ""))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
        }
        root.addView(input, LinearLayout.LayoutParams(-1, -2))
        root.addView(TextView(this).apply {
            text = "Connect to your media server."
            setPadding(0, 16, 0, 24)
        })
        root.addView(Button(this).apply {
            id = R.id.connection_button
            text = "Connect"
            setOnClickListener {
                val url = normalizeUrl(input.text.toString())
                if (Uri.parse(url).host.isNullOrBlank()) {
                    input.error = "Invalid server address"
                } else if (Uri.parse(url).scheme != "https" && Uri.parse(url).host !in setOf("localhost", "127.0.0.1")) {
                    input.error = "HTTPS is required for offline access"
                } else {
                    prefs.edit().putString("url", url).apply()
                    showBrowser(url)
                }
            }
        })
        setContentView(root)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showBrowser(startUrl: String) {
        val origin = Uri.parse(startUrl).let { "${it.scheme}://${it.authority}" }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                object : ServiceWorkerClientCompat() {
                    override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                        offlineResponse(request) ?: unavailableForTest()
                },
            )
        }
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    emitOfflineCatalog()
                    if (openOfflineOnLoad) {
                        openOfflineOnLoad = false
                        openOfflineBrowser()
                    }
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    offlineResponse(request) ?: unavailableForTest()
                    ?: super.shouldInterceptRequest(view, request)
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url
                    if (target.scheme == "derp") {
                        when (target.host) {
                            "offline" -> openOfflineBrowser()
                            "server" -> { prefs.edit().remove("url").apply(); showConnectionScreen() }
                        }
                        return true
                    }
                    val sameOrigin = "${target.scheme}://${target.authority}" == origin
                    if (!sameOrigin) {
                        startActivity(Intent(Intent.ACTION_VIEW, target))
                        return true
                    }
                    if (target.path?.contains("/workspace") == true) {
                        view.loadUrl(origin + "/")
                        return true
                    }
                    return false
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    Log.e("DerpMedia", "WebView error ${error.errorCode}: ${error.description} for ${request.url}")
                    if (!request.isForMainFrame) return
                    if (!offlineFallbackOpened && OfflineStore.hasContent(this@MainActivity)) {
                        offlineFallbackOpened = true
                        view.loadUrl("$origin/?offline=1")
                        return
                    }
                    view.loadDataWithBaseURL(
                        null,
                        """<html><body style="margin:0;background:#09090b;color:#fafafa;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="padding:32px;text-align:center;max-width:360px"><h2 style="font-size:22px">Can't reach the server</h2><p style="color:#a1a1aa;line-height:1.5">Check the address and network connection.</p><a href="derp://server" style="display:block;background:#fafafa;color:#18181b;text-decoration:none;padding:12px 16px;border-radius:10px;margin-top:24px;font-weight:600">Change server</a><a href="derp://offline" style="display:block;color:#d4d4d8;text-decoration:none;padding:12px 16px;margin-top:8px">Open offline files</a></div></body></html>""",
                        "text/html", "UTF-8", null,
                    )
                }

                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    Log.e("DerpMedia", "WebView SSL error ${error.primaryError} for ${error.url}")
                    val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
                    if (debuggable) handler.proceed() else super.onReceivedSslError(view, handler, error)
                }
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "DerpAndroid", setOf(origin)) { _, message, sourceOrigin, isMainFrame, _ ->
                if (isMainFrame && sourceOrigin.toString().trimEnd('/') == origin) handleBridge(message.data ?: return@addWebMessageListener)
            }
        }
        val shell = LinearLayout(this).apply { id = R.id.browser_shell; orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        ViewCompat.setOnApplyWindowInsetsListener(shell) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            shell.setPadding(0, max(bars.top, cutout.top), 0, max(bars.bottom, cutout.bottom))
            insets
        }
        shell.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(shell)
        webView.loadUrl(startUrl)
    }

    private fun handleBridge(raw: String) {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (json.optString("type")) {
            "play" -> {
                val url = json.getString("url")
                val local = OfflineStore.completed(this, url)
                startActivity(Intent(this, PlayerActivity::class.java).apply {
                    putExtra("url", local?.toURI()?.toString() ?: url)
                    putExtra("title", json.optString("title"))
                    putExtra("cookie", CookieManager.getInstance().getCookie(url).orEmpty())
                })
            }
            "download" -> queueDownload(json)
            "removeOffline" -> {
                OfflineStore.deletePath(this, json.optString("displayPath"))
                emitOfflineCatalog()
                emitOfflineStatus("removed", json.optString("name"), json.optString("displayPath"), 0)
                Toast.makeText(this, "Removed from offline files", Toast.LENGTH_SHORT).show()
            }
            "openOffline" -> openOfflineBrowser()
            "changeServer" -> { prefs.edit().remove("url").apply(); showConnectionScreen() }
        }
    }

    private fun queueDownload(json: JSONObject) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = json.toString()
            webView.postDelayed({
                notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }, 250)
            return
        }
        enqueueDownload(json)
    }

    private fun enqueueDownload(json: JSONObject) {
        val sourceUrl = json.optString("mediaUrl").ifBlank { json.optString("downloadUrl") }
        val cookieUrl = if (sourceUrl.isBlank()) json.optString("listUrl") else sourceUrl
        val input = Data.Builder()
            .putString("name", json.optString("name"))
            .putString("path", json.optString("path"))
            .putString("displayPath", json.optString("displayPath", json.optString("path")))
            .putString("mediaType", json.optString("mediaType", "other"))
            .putBoolean("directory", json.optBoolean("isDirectory"))
            .putString("sourceUrl", sourceUrl)
            .putString("listUrl", json.optString("listUrl"))
            .putString("mediaBaseUrl", json.optString("mediaBaseUrl"))
            .putString("cookie", CookieManager.getInstance().getCookie(cookieUrl).orEmpty())
            .build()
        val request = OneTimeWorkRequestBuilder<OfflineWorker>().setInputData(input).build()
        val manager = WorkManager.getInstance(this)
        manager.getWorkInfoByIdLiveData(request.id).observe(this) { info ->
            if (info == null) return@observe
            val state = when (info.state) {
                WorkInfo.State.RUNNING -> "running"
                WorkInfo.State.SUCCEEDED -> "succeeded"
                WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> "failed"
                else -> "queued"
            }
            emitOfflineStatus(
                state,
                json.optString("name"),
                json.optString("displayPath", json.optString("path")),
                info.progress.getInt("completed", 0),
            )
            if (info.state == WorkInfo.State.SUCCEEDED) emitOfflineCatalog()
        }
        manager.enqueue(request)
        Toast.makeText(this, "Added to offline downloads", Toast.LENGTH_SHORT).show()
    }

    private fun emitOfflineStatus(state: String, name: String, path: String, completed: Int) {
        if (!::webView.isInitialized) return
        val detail = JSONObject().apply {
            put("state", state)
            put("name", name)
            put("path", path)
            put("completed", completed)
        }.toString()
        webView.post {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('derp-offline-status',{detail:$detail}))",
                null,
            )
        }
    }

    private fun emitOfflineCatalog() {
        if (!::webView.isInitialized) return
        val paths = JSONArray(OfflineStore.entries(this).map { it.path.trim('/').replace('\\', '/') })
        webView.post {
            webView.evaluateJavascript(
                "window.__DERP_OFFLINE_PATHS__=$paths;window.dispatchEvent(new Event('derp-offline-catalog'))",
                null,
            )
        }
    }

    private fun openOfflineBrowser() {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript(
            "history.pushState(null,'','/?offline=1');window.dispatchEvent(new PopStateEvent('popstate'))",
            null,
        )
    }

    private fun offlineResponse(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        if (uri.path == "/__offline/files") {
            val dir = uri.getQueryParameter("dir").orEmpty().trim('/').replace('\\', '/')
            val entries = OfflineStore.entries(this)
            val children = linkedMapOf<String, JSONObject>()
            for (entry in entries) {
                val path = entry.path.trim('/').replace('\\', '/')
                val relative = when {
                    dir.isEmpty() -> path
                    path == dir -> continue
                    path.startsWith("$dir/") -> path.removePrefix("$dir/")
                    else -> continue
                }
                if (relative.isEmpty()) continue
                val name = relative.substringBefore('/')
                val childPath = if (dir.isEmpty()) name else "$dir/$name"
                val isDirectory = relative.contains('/') || entry.isDirectory
                val existing = children[name]
                if (existing != null && !isDirectory) continue
                val exact = entries.firstOrNull { it.path.trim('/').replace('\\', '/') == childPath }
                children[name] = JSONObject().apply {
                    put("name", name)
                    put("path", childPath)
                    put("type", if (isDirectory) "folder" else exact?.mediaType ?: entry.mediaType)
                    put("size", if (isDirectory) 0 else exact?.file?.length() ?: entry.file?.length() ?: 0)
                    put("extension", if (isDirectory) "" else name.substringAfterLast('.', ""))
                    put("isDirectory", isDirectory)
                    put("thumbnailGenerated", !isDirectory && (exact?.mediaType ?: entry.mediaType) == "image")
                }
            }
            val body = JSONObject().put("files", JSONArray(children.values)).toString()
            return WebResourceResponse(
                "application/json",
                "UTF-8",
                ByteArrayInputStream(body.toByteArray()),
            )
        }

        val encodedPath = uri.encodedPath ?: return null
        val isShareThumbnail = Regex("^/api/share/[^/]+/thumbnail/").containsMatchIn(encodedPath)
        val isThumbnail = encodedPath.startsWith("/api/thumbnail/") || isShareThumbnail
        val isAdminMedia = encodedPath.startsWith("/api/media/") || isThumbnail
        val isShareMedia = Regex("^/api/share/[^/]+/media/").containsMatchIn(encodedPath) || isShareThumbnail
        if (!isAdminMedia && !isShareMedia) return null
        val logicalPath = if (isAdminMedia) {
            Uri.decode(
                encodedPath.removePrefix(if (isThumbnail) "/api/thumbnail/" else "/api/media/"),
            ).trim('/')
        } else ""
        val entry = OfflineStore.entries(this).firstOrNull {
            !it.isDirectory && (
                (isAdminMedia && it.path.trim('/').replace('\\', '/') == logicalPath) ||
                    (isShareMedia && (
                        it.url == uri.toString() ||
                            (isShareThumbnail && it.url.replace("/media/", "/thumbnail/") == uri.toString())
                        ))
                )
        } ?: return null
        if (isThumbnail && entry.mediaType != "image") return null
        val file = entry.file ?: return null
        val mime = URLConnection.guessContentTypeFromName(entry.title) ?: when (entry.mediaType) {
            "audio" -> "audio/*"
            "video" -> "video/*"
            "image" -> "image/*"
            "pdf" -> "application/pdf"
            "text" -> "text/plain"
            else -> "application/octet-stream"
        }
        val range = request.requestHeaders["Range"] ?: request.requestHeaders["range"]
        val match = range?.let { Regex("^bytes=(\\d+)-(\\d*)$").matchEntire(it) }
        if (match != null) {
            val start = match.groupValues[1].toLong()
            val end = match.groupValues[2].toLongOrNull()?.coerceAtMost(file.length() - 1)
                ?: (file.length() - 1)
            if (start <= end && start < file.length()) {
                val stream = FileInputStream(file)
                stream.skip(start)
                return WebResourceResponse(
                    mime,
                    null,
                    206,
                    "Partial Content",
                    mapOf(
                        "Accept-Ranges" to "bytes",
                        "Content-Length" to (end - start + 1).toString(),
                        "Content-Range" to "bytes $start-$end/${file.length()}",
                    ),
                    LimitedInputStream(stream, end - start + 1),
                )
            }
        }
        return WebResourceResponse(
            mime,
            null,
            200,
            "OK",
            mapOf("Accept-Ranges" to "bytes", "Content-Length" to file.length().toString()),
            FileInputStream(file),
        )
    }

    private fun unavailableForTest(): WebResourceResponse? {
        if (!simulateOfflineForTest) return null
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            503,
            "Offline",
            emptyMap(),
            ByteArrayInputStream("Offline".toByteArray()),
        )
    }

    internal fun webViewForTest(): WebView = webView
    internal fun offlineResponseForTest(request: WebResourceRequest): WebResourceResponse? =
        offlineResponse(request)
}

private class LimitedInputStream(input: FileInputStream, private var remaining: Long) :
    FilterInputStream(input) {
    override fun read(): Int {
        if (remaining <= 0) return -1
        val value = super.read()
        if (value >= 0) remaining -= 1
        return value
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (remaining <= 0) return -1
        val count = super.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
        if (count > 0) remaining -= count
        return count
    }
}

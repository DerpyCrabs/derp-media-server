package com.derpmedia.app

import android.annotation.SuppressLint
import android.content.Intent
import android.app.DownloadManager
import android.content.Context
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
import androidx.appcompat.app.AlertDialog
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
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("connection", MODE_PRIVATE) }
    private var pendingDownload: String? = null
    private var offlineFallbackOpened = false
    private var openOfflineOnLoad = false
    private var simulateOfflineForTest = false
    private val connectionExecutor = Executors.newSingleThreadExecutor()
    private var connectionAttempt = 0
    private var resolveAttempt = 0
    private var httpWarningDialog: AlertDialog? = null
    private var hasEnteredForeground = false
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
        if (saved == null) showConnectionScreen() else connectToServer(saved, true)
    }

    override fun onResume() {
        super.onResume()
        if (hasEnteredForeground && ::webView.isInitialized) requestFrontendUpdate()
        hasEnteredForeground = true
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
        ViewCompat.requestApplyInsets(root)
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
            text = "HTTPS and HTTP are detected automatically. Offline access requires HTTPS."
            setPadding(0, 16, 0, 24)
        })
        val connect = Button(this).apply {
            id = R.id.connection_button
            text = "Connect"
            setOnClickListener {
                text = "Checking…"
                isEnabled = false
                connectToServer(input.text.toString(), false) { message ->
                    input.error = message
                    text = "Connect"
                    isEnabled = true
                }
            }
        }
        root.addView(connect)
        val remembered = rememberedServers()
        if (remembered.isNotEmpty()) {
            val recentServers = LinearLayout(this).apply {
                id = R.id.recent_servers
                orientation = LinearLayout.VERTICAL
            }
            recentServers.addView(TextView(this).apply {
                text = "Recent servers"
                textSize = 16f
                setPadding(0, 28, 0, 8)
            })
            for (server in remembered) {
                recentServers.addView(Button(this).apply {
                    text = server
                    isAllCaps = false
                    setOnClickListener { connectToServer(server, false) }
                })
            }
            root.addView(recentServers)
        }
        setContentView(root)
    }

    private fun connectToServer(value: String, fallbackToOffline: Boolean, onFailure: ((String) -> Unit)? = null) {
        val candidates = ServerConnectionResolver.candidates(value)
        if (candidates.isEmpty() || Uri.parse(candidates.first()).host.isNullOrBlank()) {
            onFailure?.invoke("Invalid server address")
            return
        }
        val attempt = ++resolveAttempt
        connectionExecutor.execute {
            val resolved = if (simulateOfflineForTest) null else ServerConnectionResolver.resolve(value)
            runOnUiThread {
                if (attempt != resolveAttempt || isFinishing || isDestroyed) return@runOnUiThread
                if (resolved == null) {
                    if (fallbackToOffline) showBrowser(candidates.first(), true)
                    else onFailure?.invoke("Can't reach this server over HTTPS or HTTP")
                    return@runOnUiThread
                }
                if (Uri.parse(resolved).scheme == "http" && Uri.parse(resolved).host !in setOf("localhost", "127.0.0.1")) {
                    showHttpWarning(resolved)
                } else {
                    rememberServer(resolved)
                    prefs.edit().putString("url", resolved).apply()
                    showBrowser(resolved)
                }
            }
        }
    }

    private fun showHttpWarning(url: String) {
        httpWarningDialog = AlertDialog.Builder(this)
            .setTitle("Offline mode unavailable")
            .setMessage("This server only supports HTTP. You can connect, but Android cannot install the Service Worker, so offline files will not be available.")
            .setNegativeButton("Cancel") { _, _ -> showConnectionScreen() }
            .setPositiveButton("Connect anyway") { _, _ ->
                rememberServer(url)
                prefs.edit().putString("url", url).apply()
                showBrowser(url)
            }
            .create().also(AlertDialog::show)
    }

    private fun rememberedServers(): List<String> = prefs.getStringSet("servers", emptySet())
        .orEmpty().sorted()

    private fun rememberServer(url: String) {
        val servers = rememberedServers().toMutableSet()
        servers.add(url.trimEnd('/'))
        prefs.edit().putStringSet("servers", servers).apply()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showBrowser(startUrl: String, preferOffline: Boolean = false) {
        connectionAttempt += 1
        offlineFallbackOpened = false
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
                    view.evaluateJavascript(
                        """
                        (() => {
                          const raw = sessionStorage.getItem('derp-android-update-position');
                          if (!raw) return;
                          sessionStorage.removeItem('derp-android-update-position');
                          try {
                            const saved = JSON.parse(raw);
                            if (saved.href !== location.href) return;
                            let attempts = 0;
                            const restore = () => {
                              scrollTo(saved.x || 0, saved.y || 0);
                              attempts += 1;
                              if (attempts < 30 && Math.abs(scrollY - (saved.y || 0)) > 1) setTimeout(restore, 100);
                            };
                            requestAnimationFrame(restore);
                          } catch {}
                        })()
                        """.trimIndent(),
                        null,
                    )
                    emitOfflineCatalog()
                    if (openOfflineOnLoad) {
                        openOfflineOnLoad = false
                        view.loadUrl("$origin/?offline=1")
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
                            "retry" -> prefs.getString("url", null)?.let { connectToServer(it, true) }
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
                    if (openCachedOfflineShell(origin)) {
                        return
                    }
                    showConnectionError()
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
        ViewCompat.requestApplyInsets(shell)
        if (!preferOffline || !openCachedOfflineShell(origin)) webView.loadUrl(startUrl)
    }

    private fun requestFrontendUpdate() {
        webView.evaluateJavascript(
            """
            (() => {
              if (!('serviceWorker' in navigator)) return;
              const savePosition = () => sessionStorage.setItem(
                'derp-android-update-position',
                JSON.stringify({ href: location.href, x: scrollX, y: scrollY }),
              );
              const watch = (registration) => {
                if (!registration || window.__DERP_ANDROID_UPDATE_WATCH__) return;
                window.__DERP_ANDROID_UPDATE_WATCH__ = true;
                registration.addEventListener('updatefound', () => {
                  const worker = registration.installing;
                  if (!worker) return;
                  worker.addEventListener('statechange', () => {
                    if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
                    savePosition();
                    window.__DERP_ANDROID_UPDATE_PENDING__ = true;
                  });
                });
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                  if (!window.__DERP_ANDROID_UPDATE_PENDING__) return;
                  window.__DERP_ANDROID_UPDATE_PENDING__ = false;
                  location.reload();
                });
              };
              navigator.serviceWorker.getRegistration().then((registration) => {
                watch(registration);
                return registration?.update();
              }).catch(() => {});
            })()
            """.trimIndent(),
            null,
        )
    }

    private fun openCachedOfflineShell(origin: String): Boolean {
        if (offlineFallbackOpened || !OfflineStore.hasContent(this)) return false
        if (!prefs.getBoolean("offlineShell:$origin", false)) return false
        offlineFallbackOpened = true
        webView.loadUrl("$origin/?offline=1")
        return true
    }

    private fun showConnectionError() {
        webView.loadDataWithBaseURL(
            null,
            """<html><body style="margin:0;background:#09090b;color:#fafafa;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="padding:32px;text-align:center;max-width:360px"><h2 style="font-size:22px">Can't reach the server</h2><p style="color:#a1a1aa;line-height:1.5">Check the address and network connection.</p><a href="derp://retry" style="display:block;background:#fafafa;color:#18181b;text-decoration:none;padding:12px 16px;border-radius:10px;margin-top:24px;font-weight:600">Retry</a><a href="derp://server" style="display:block;color:#d4d4d8;text-decoration:none;padding:12px 16px;margin-top:8px">Change server</a></div></body></html>""",
            "text/html", "UTF-8", null,
        )
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
            "deviceDownload" -> {
                val url = json.optString("url")
                if (url.isBlank()) return
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setTitle(json.optString("name", "Download"))
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() }
                        ?.let { addRequestHeader("Cookie", it) }
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show()
            }
            "removeOffline" -> {
                OfflineStore.deletePath(this, json.optString("displayPath"))
                emitOfflineCatalog()
                emitOfflineStatus("removed", json.optString("name"), json.optString("displayPath"), 0)
                Toast.makeText(this, "Removed from offline files", Toast.LENGTH_SHORT).show()
            }
            "openOffline" -> openOfflineBrowser()
            "changeServer" -> { prefs.edit().remove("url").apply(); showConnectionScreen() }
            "serviceWorkerReady" -> {
                val origin = json.optString("origin")
                if (origin.isNotBlank()) prefs.edit().putBoolean("offlineShell:$origin", true).apply()
            }
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
            .putString("thumbnailUrl", json.optString("thumbnailUrl"))
            .putString("thumbnailBaseUrl", json.optString("thumbnailBaseUrl"))
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
                    put("thumbnailGenerated", !isDirectory && exact?.thumbnailFile?.isFile == true)
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
        val file = if (isThumbnail) entry.thumbnailFile else entry.file ?: return null
        if (file?.isFile != true) return null
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
    internal fun showHttpWarningForTest(url: String) = showHttpWarning(url)
    internal fun httpWarningDialogForTest(): AlertDialog? = httpWarningDialog
    internal fun offlineResponseForTest(request: WebResourceRequest): WebResourceResponse? =
        offlineResponse(request)

    override fun onDestroy() {
        resolveAttempt += 1
        connectionAttempt += 1
        connectionExecutor.shutdownNow()
        super.onDestroy()
    }
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

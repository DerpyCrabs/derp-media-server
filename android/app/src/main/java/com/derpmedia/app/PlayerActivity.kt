package com.derpmedia.app

import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView

class PlayerActivity : AppCompatActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var playerView: PlayerView

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        supportActionBar?.hide()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.BLACK)
        }
        val title = TextView(this).apply {
            text = intent.getStringExtra("title").orEmpty()
            setTextColor(android.graphics.Color.WHITE)
            textSize = 16f
            setPadding(24, 16, 24, 16)
        }
        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        playerView = PlayerView(this).apply {
            useController = true
            keepScreenOn = true
        }
        root.addView(playerView, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        val url = intent.getStringExtra("url") ?: return finish()
        val cookie = intent.getStringExtra("cookie").orEmpty()
        val dataSourceFactory = DefaultHttpDataSource.Factory().apply {
            if (cookie.isNotBlank()) setDefaultRequestProperties(mapOf("Cookie" to cookie))
        }
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, dataSourceFactory)))
            .build()
        playerView.player = player
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
        player.prepare()
        player.playWhenReady = true
    }

    override fun onDestroy() {
        if (::player.isInitialized) {
            player.release()
        }
        super.onDestroy()
    }
}

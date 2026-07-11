package com.derpmedia.app

import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

class PlayerActivity : AppCompatActivity() {
    private lateinit var libVlc: LibVLC
    private lateinit var player: MediaPlayer
    private lateinit var video: VLCVideoLayout
    private lateinit var playPause: Button
    private lateinit var seek: SeekBar
    private var dragging = false

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
        video = VLCVideoLayout(this)
        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        root.addView(video, LinearLayout.LayoutParams(-1, 0, 1f))

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(12, 8, 12, 16)
        }
        playPause = Button(this).apply {
            text = "Pause"
            setOnClickListener {
                if (player.isPlaying) player.pause() else player.play()
                text = if (player.isPlaying) "Pause" else "Play"
            }
        }
        seek = SeekBar(this).apply {
            max = 1000
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, progress: Int, fromUser: Boolean) {}
                override fun onStartTrackingTouch(bar: SeekBar?) { dragging = true }
                override fun onStopTrackingTouch(bar: SeekBar?) {
                    player.position = progress / 1000f
                    dragging = false
                }
            })
        }
        controls.addView(playPause)
        controls.addView(seek, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(controls, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)

        libVlc = LibVLC(this, arrayListOf("--network-caching=1500", "--audio-time-stretch"))
        player = MediaPlayer(libVlc)
        player.attachViews(video, null, false, false)
        player.setEventListener { event ->
            runOnUiThread {
                when (event.type) {
                    MediaPlayer.Event.Playing -> playPause.text = "Pause"
                    MediaPlayer.Event.Paused, MediaPlayer.Event.Stopped, MediaPlayer.Event.EndReached -> playPause.text = "Play"
                    MediaPlayer.Event.PositionChanged -> if (!dragging) seek.progress = (event.positionChanged * 1000).toInt()
                }
            }
        }
        val url = intent.getStringExtra("url") ?: return finish()
        val media = Media(libVlc, Uri.parse(url))
        val cookie = intent.getStringExtra("cookie").orEmpty()
        if (cookie.isNotBlank()) media.addOption(":http-cookie=$cookie")
        media.setHWDecoderEnabled(true, false)
        player.media = media
        media.release()
        player.play()
    }

    override fun onDestroy() {
        if (::player.isInitialized) {
            player.stop()
            player.detachViews()
            player.release()
        }
        if (::libVlc.isInitialized) libVlc.release()
        super.onDestroy()
    }
}

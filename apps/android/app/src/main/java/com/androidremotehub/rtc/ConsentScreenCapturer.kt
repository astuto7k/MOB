package com.androidremotehub.rtc

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.Surface
import android.view.WindowManager
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import kotlin.math.max
import kotlin.math.roundToInt

/** One consent Intent, one projection, one virtual display. Rotation resizes that display in place. */
class ConsentScreenCapturer(
    private val consent: Intent,
    private val onStopped: () -> Unit,
    private val onSize: (Int, Int) -> Unit
) : VideoCapturer {
    private lateinit var context: Context
    private lateinit var helper: SurfaceTextureHelper
    private lateinit var observer: CapturerObserver
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var surface: Surface? = null
    @Volatile private var stopped = true
    private var used = false
    private var maxEdge = 1280
    private var contentWidth = 720
    private var contentHeight = 1280
    private var displayListenerRegistered = false
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {}
        override fun onDisplayRemoved(displayId: Int) { if (displayId == Display.DEFAULT_DISPLAY) onStopped() }
        override fun onDisplayChanged(displayId: Int) {
            if (Build.VERSION.SDK_INT < 34 && displayId == Display.DEFAULT_DISPLAY && !stopped) {
                val (w, h) = screenDimensions(context)
                contentWidth = w; contentHeight = h; resize()
            }
        }
    }
    private fun screenDimensions(ctx: Context): Pair<Int, Int> {
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = ctx.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val dm = ctx.resources.displayMetrics
            dm.widthPixels to dm.heightPixels
        }
    }
    private val callback = object : MediaProjection.Callback() {
        override fun onStop() { onStopped() }
        override fun onCapturedContentResize(width: Int, height: Int) {
            if (!stopped && width > 0 && height > 0) {
                contentWidth = width; contentHeight = height
                resize()
            }
        }
    }
    override fun initialize(surfaceTextureHelper: SurfaceTextureHelper, applicationContext: Context, capturerObserver: CapturerObserver) {
        helper = surfaceTextureHelper; context = applicationContext; observer = capturerObserver
    }
    @Synchronized override fun startCapture(width: Int, height: Int, framerate: Int) {
        check(!used) { "Consentimento de captura não pode ser reutilizado" }
        used = true; stopped = false
        val (sw, sh) = screenDimensions(context)
        contentWidth = sw; contentHeight = sh
        val size = captureSize(); helper.setTextureSize(size.first, size.second)
        surface = Surface(helper.surfaceTexture)
        val manager = context.getSystemService(MediaProjectionManager::class.java)
        projection = checkNotNull(manager.getMediaProjection(Activity.RESULT_OK, consent)) { "Captura não autorizada" }.also { p ->
            p.registerCallback(callback, Handler(Looper.getMainLooper()))
            display = p.createVirtualDisplay("Android Remote Hub — consentido", size.first, size.second,
                context.resources.displayMetrics.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null)
        }
        if (Build.VERSION.SDK_INT < 34) {
            context.getSystemService(DisplayManager::class.java).registerDisplayListener(displayListener, Handler(Looper.getMainLooper()))
            displayListenerRegistered = true
        }
        helper.startListening { frame -> if (!stopped) observer.onFrameCaptured(frame) }
        observer.onCapturerStarted(true)
        onSize(size.first, size.second)
    }
    private fun captureSize(): Pair<Int, Int> {
        val scale = (maxEdge.toFloat() / max(contentWidth, contentHeight)).coerceAtMost(1f)
        val w = max(2, (contentWidth * scale).roundToInt() / 2 * 2)
        val h = max(2, (contentHeight * scale).roundToInt() / 2 * 2)
        return w to h
    }
    @Synchronized private fun resize() {
        if (stopped) return
        val size = captureSize()
        helper.setTextureSize(size.first, size.second)
        display?.resize(size.first, size.second, context.resources.displayMetrics.densityDpi)
        onSize(size.first, size.second)
    }
    fun setLowQuality(low: Boolean) { maxEdge = if (low) 854 else 1280; resize() }
    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) { resize() }
    @Synchronized override fun stopCapture() {
        if (stopped) return
        stopped = true
        if (displayListenerRegistered) {
            context.getSystemService(DisplayManager::class.java).unregisterDisplayListener(displayListener)
            displayListenerRegistered = false
        }
        helper.stopListening()
        display?.release(); display = null
        surface?.release(); surface = null
        projection?.unregisterCallback(callback)
        projection?.stop(); projection = null
        observer.onCapturerStopped()
    }
    override fun dispose() { stopCapture() }
    override fun isScreencast() = true
    override fun isCapturing() = !stopped
}

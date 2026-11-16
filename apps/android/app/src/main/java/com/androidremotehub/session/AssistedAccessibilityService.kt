package com.androidremotehub.session

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.graphics.Path
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

/** No text/event extraction: checks only active package and focused input's password flag. */
class AssistedAccessibilityService : AccessibilityService() {
    companion object { @Volatile var instance: AssistedAccessibilityService? = null; private set }
    override fun onServiceConnected() { instance = this; com.androidremotehub.data.HubRepository.update { it.copy(accessibilityEnabled = true) } }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* Never inspect or retain event content. */ }
    override fun onInterrupt() { SharingService.current?.suspendControl() }
    override fun onDestroy() { instance = null; com.androidremotehub.data.HubRepository.update { it.copy(accessibilityEnabled = false) }; SharingService.current?.suspendControl(); super.onDestroy() }
    fun dispatch(command: JSONObject, gate: AuthorizationGate): Boolean {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Handler(Looper.getMainLooper()).post { dispatch(command, gate) }
            return true
        }
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        val password = focused?.isPassword == true
        val pkg = root.packageName?.toString()
        val unlocked = !getSystemService(KeyguardManager::class.java).isKeyguardLocked
        val seq = command.optLong("seq", -1)
        if (!gate.authorize(seq, pkg, unlocked, password)) return false
        val (screenW, screenH) = if (android.os.Build.VERSION.SDK_INT >= 30) {
            val b = getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val dm = resources.displayMetrics
            dm.widthPixels to dm.heightPixels
        }
        fun coordinate(name: String, max: Int): Float {
            val n = command.optDouble(name, Double.NaN)
            require(n.isFinite() && n in 0.0..1.0) { "Coordenada inválida" }
            return (n * (max - 1)).toFloat()
        }
        return runCatching {
            when (command.getString("type")) {
                "tap" -> {
                    val path = Path().apply { moveTo(coordinate("x", screenW), coordinate("y", screenH)) }
                    dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 70)).build(), null, null)
                }
                "swipe" -> {
                    val duration = command.optLong("durationMs", 300).coerceIn(100, 1500)
                    val path = Path().apply {
                        moveTo(coordinate("x", screenW), coordinate("y", screenH))
                        lineTo(coordinate("toX", screenW), coordinate("toY", screenH))
                    }
                    dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(), null, null)
                }
                "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
                "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
                "text" -> {
                    val text = command.optString("text")
                    require(text.isNotEmpty() && text.length <= 256 && text.none { it.isISOControl() })
                    if (focused == null || !focused.isEditable || focused.isPassword) false
                    else focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                    })
                }
                else -> false
            }
        }.getOrDefault(false)
    }
}

package com.androidremotehub.data

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.androidremotehub.session.AssistedAccessibilityService
import org.json.JSONObject

object DeviceTelemetry {
    fun heartbeat(context: Context): JSONObject {
        val battery = context.getSystemService(BatteryManager::class.java)
        val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = sticky?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val network = cm.getNetworkCapabilities(cm.activeNetwork)
        val kind = when {
            network?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
            network?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "CELLULAR"
            network?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ETHERNET"
            network == null -> "OFFLINE"
            else -> "UNKNOWN"
        }
        val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return JSONObject().put("battery", if (level in 0..100) level else JSONObject.NULL)
            .put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
            .put("network", kind).put("permissions", JSONObject()
                .put("accessibility", AssistedAccessibilityService.instance != null)
                .put("notifications", Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                .put("screenCapture", HubRepository.state.value.active != null).put("files", true))
    }
}

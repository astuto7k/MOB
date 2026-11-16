package com.androidremotehub

import android.app.Application
import com.androidremotehub.data.HubRepository

class HubApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // A killed process cannot resume capture; remove its bounded, private transfer scratch files.
        cacheDir.listFiles()?.filter { it.name.startsWith("arh-receive-") || it.name.startsWith("arh-send-") }?.forEach { it.delete() }
        HubRepository.initialize(this)
        HubNotifications.createChannels(this)
        com.androidremotehub.notifications.NotificationIntegration.initialize(this)
    }
}

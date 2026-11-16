package com.androidremotehub.notifications

import com.androidremotehub.HubNotifications
import com.androidremotehub.data.HubRepository
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class HubMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { NotificationIntegration.register(token) }
    override fun onMessageReceived(message: RemoteMessage) {
        val name = HubRepository.state.value.identity?.name ?: "Seu Android"
        HubNotifications.request(this, name)
        // A push is only a visible prompt. Capture always starts from MainActivity consent.
    }
}

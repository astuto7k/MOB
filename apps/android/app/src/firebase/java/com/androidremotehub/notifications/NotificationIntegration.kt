package com.androidremotehub.notifications

import android.content.Context
import com.androidremotehub.BuildConfig
import com.androidremotehub.data.HubApi
import com.androidremotehub.data.HubRepository
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

object NotificationIntegration {
    fun initialize(context: Context) {
        if (BuildConfig.FIREBASE_APPLICATION_ID.isBlank() || BuildConfig.FIREBASE_API_KEY.isBlank() || BuildConfig.FIREBASE_PROJECT_ID.isBlank() || BuildConfig.FIREBASE_SENDER_ID.isBlank()) return
        if (FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID).setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build())
        FirebaseMessaging.getInstance().token.addOnSuccessListener { register(it) }
    }
    fun register(token: String) {
        val identity = HubRepository.state.value.identity ?: return
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { HubApi(identity).json("/device/push-token", JSONObject().put("token", token)) }
        }
    }
}

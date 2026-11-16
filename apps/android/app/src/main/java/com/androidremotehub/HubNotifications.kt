package com.androidremotehub

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.androidremotehub.session.SharingService

object HubNotifications {
    const val SHARING = "sharing"
    const val REQUESTS = "requests"
    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            context.getSystemService(NotificationManager::class.java)?.apply {
                createNotificationChannel(NotificationChannel(SHARING, "Compartilhamento ativo", NotificationManager.IMPORTANCE_LOW))
                createNotificationChannel(NotificationChannel(REQUESTS, "Pedidos de assistência", NotificationManager.IMPORTANCE_HIGH))
            }
        }
    }
    fun sharing(context: Context): Notification {
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(context, 1, Intent(context, SharingService::class.java).setAction(SharingService.ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(context, SHARING).setSmallIcon(R.drawable.ic_hub)
            .setContentTitle("Sua tela está sendo compartilhada")
            .setContentText("Android Remote Hub • toque para gerenciar ou encerrar")
            .setContentIntent(open).setOngoing(true).setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, "ENCERRAR AGORA", stop).build()
    }
    fun request(context: Context, deviceName: String) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(context, 2, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        NotificationManagerCompat.from(context).notify(23, NotificationCompat.Builder(context, REQUESTS)
            .setSmallIcon(R.drawable.ic_hub).setContentTitle("Pedido de assistência: $deviceName")
            .setContentText("Abra o app e decida se deseja compartilhar sua tela.")
            .setContentIntent(open).setAutoCancel(true).build())
    }
}

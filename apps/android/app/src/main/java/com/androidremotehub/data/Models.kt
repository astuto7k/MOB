package com.androidremotehub.data

import org.json.JSONObject

data class DeviceIdentity(val serverUrl: String, val deviceId: String, val name: String, val token: String)
data class RemoteSession(
    val id: String, val deviceId: String, val status: String,
    val requestedControl: Boolean, val controlApproved: Boolean,
    val expiresAt: String, val operator: String = "Proprietário autenticado"
) {
    companion object {
        fun fromJson(j: JSONObject) = RemoteSession(
            j.getString("id"), j.getString("deviceId"), j.getString("status"),
            j.optBoolean("requestedControl"), j.optBoolean("controlApproved"),
            j.getString("expiresAt"), j.optJSONObject("operator")?.optString("email") ?: "Proprietário autenticado"
        )
    }
}
data class HistoryEntry(val sessionId: String, val at: String, val event: String)
data class FilePrompt(val id: String, val name: String, val size: Long, val sha256: String, val direction: String)
data class DevicePolicy(val maxFileBytes: Long, val maxSessionMinutes: Int) {
    companion object {
        fun fromJson(j: JSONObject): DevicePolicy {
            val bytes = j.getLong("maxFileBytes")
            val minutes = j.getInt("maxSessionMinutes")
            check(bytes in 1024L..20L * 1024L * 1024L && minutes in 1..120) { "Política do servidor fora dos limites suportados" }
            return DevicePolicy(bytes, minutes)
        }
    }
}
data class HubUiState(
    val identity: DeviceIdentity? = null,
    val requests: List<RemoteSession> = emptyList(),
    val active: RemoteSession? = null,
    val connection: String = "Abra o app para receber solicitações",
    val controlEnabled: Boolean = false,
    val accessibilityEnabled: Boolean = false,
    val error: String? = null,
    val history: List<HistoryEntry> = emptyList(),
    val filePrompt: FilePrompt? = null,
    val filePickRequested: Boolean = false,
    val fileProgress: Float? = null,
    val fileMessage: String? = null,
    val policy: DevicePolicy? = null,
    val policyCheckedAt: String? = null
)

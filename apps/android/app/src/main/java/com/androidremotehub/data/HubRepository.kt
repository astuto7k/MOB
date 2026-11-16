package com.androidremotehub.data

import android.content.Context
import com.androidremotehub.security.CredentialVault
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object HubRepository {
    private lateinit var historyPrefs: android.content.SharedPreferences
    lateinit var vault: CredentialVault; private set
    private val mutable = MutableStateFlow(HubUiState())
    val state = mutable.asStateFlow()
    private fun nowIso(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
    fun initialize(app: Context) {
        val context = app.applicationContext
        historyPrefs = context.getSharedPreferences("arh.history", Context.MODE_PRIVATE)
        vault = CredentialVault(context)
        val entries = runCatching {
            val j = JSONArray(historyPrefs.getString("events", "[]"))
            (0 until j.length()).map { i -> j.getJSONObject(i).let { HistoryEntry(it.getString("sessionId"), it.getString("at"), it.getString("event")) } }
        }.getOrDefault(emptyList())
        mutable.update { it.copy(identity = vault.load(), history = entries) }
    }
    fun update(block: (HubUiState) -> HubUiState) = mutable.update(block)
    fun paired(identity: DeviceIdentity) { vault.save(identity); update { it.copy(identity = identity, error = null) } }
    fun policyObserved(identity: DeviceIdentity, policy: DevicePolicy) = update {
        if (it.identity == identity) it.copy(policy = policy, policyCheckedAt = nowIso()) else it
    }
    fun forget() { vault.clear(); update { HubUiState(history = it.history) } }
    @Synchronized fun record(sessionId: String, event: String) {
        val entry = HistoryEntry(sessionId, nowIso(), event)
        update { it.copy(history = (listOf(entry) + it.history).take(100)) }
        val entries = JSONArray()
        state.value.history.forEach { entries.put(JSONObject().put("sessionId", it.sessionId).put("at", it.at).put("event", it.event)) }
        historyPrefs.edit().putString("events", entries.toString()).apply()
    }
    fun error(message: String?) = update { it.copy(error = message) }
}

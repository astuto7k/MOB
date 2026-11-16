package com.androidremotehub.session

import android.app.KeyguardManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.ServiceCompat
import com.androidremotehub.HubNotifications
import com.androidremotehub.data.DeviceTelemetry
import com.androidremotehub.data.HubApi
import com.androidremotehub.data.HubRepository
import com.androidremotehub.data.RemoteSession
import com.androidremotehub.rtc.RtcSession
import kotlinx.coroutines.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class SharingService : Service() {
    companion object {
        const val ACTION_STOP = "com.androidremotehub.STOP"
        const val EXTRA_CONSENT = "consent"
        const val EXTRA_SESSION = "session"
        const val EXTRA_CONTROL = "control"
        @Volatile var current: SharingService? = null; private set
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val gate = AuthorizationGate(SystemClock::elapsedRealtime)
    private var rtc: RtcSession? = null
    private var api: HubApi? = null
    private var sessionId: String? = null
    private var leaseJob: Job? = null
    private var authorityPoll: Job? = null
    private var telemetryJob: Job? = null
    private var started = false
    private var stopping = false
    private var receiverRegistered = false
    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) { stopNow("Tela bloqueada: compartilhamento encerrado") }
    }
    override fun onCreate() {
        super.onCreate(); current = this
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOff, filter, RECEIVER_NOT_EXPORTED) else registerReceiver(screenOff, filter)
        receiverRegistered = true
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopNow("Encerrada localmente pelo proprietário"); return START_NOT_STICKY }
        if (started || intent == null) { if (!started) stopSelf(); return START_NOT_STICKY }
        val consent: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_CONSENT, Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_CONSENT)
        val id = intent.getStringExtra(EXTRA_SESSION)
        val identity = HubRepository.state.value.identity
        if (consent == null || id == null || identity == null || getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
            stopSelf(); return START_NOT_STICKY
        }
        started = true; sessionId = id
        val a = HubApi(identity); api = a
        val allowControl = intent.getBooleanExtra(EXTRA_CONTROL, false) && AssistedAccessibilityService.instance != null
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(this, 11, HubNotifications.sharing(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            } else {
                startForeground(11, HubNotifications.sharing(this))
            }
        } catch (_: Exception) {
            stopNow("O Android recusou o serviço de captura. Nenhuma transmissão foi iniciada.")
            return START_NOT_STICKY
        }
        gate.begin(id, allowControl)
        HubRepository.update { it.copy(connection = "Autorizando sessão…", error = null) }
        scope.launch {
            try {
                val approved = RemoteSession.fromJson(a.json("/sessions/$id/approve", JSONObject().put("control", allowControl)))
                check(!stopping) { "Sessão encerrada localmente" }
                gate.renew(id, approved.status, approved.controlApproved)
                HubRepository.update { it.copy(active = approved, requests = it.requests.filterNot { r -> r.id == id }, connection = "Conectando transmissão…") }
                HubRepository.record(id, "Compartilhamento autorizado no aparelho")
                val remote = RtcSession(applicationContext, scope, a, approved, gate, ::stopNow)
                rtc = remote
                remote.prepare(consent)
                check(!stopping)
                remote.connectSignaling()
                monitorLease(approved.expiresAt)
            } catch (e: Exception) {
                if (e !is CancellationException) stopNow("Falha ao iniciar compartilhamento: ${e.message?.take(140) ?: "tente novamente"}")
            }
        }
        return START_NOT_STICKY
    }
    private fun monitorLease(expiresAt: String) {
        val deadline = runCatching {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(expiresAt)?.time
        }.getOrNull() ?: (System.currentTimeMillis() + 30 * 60_000L)
        val negotiationStarted = SystemClock.elapsedRealtime()
        leaseJob = scope.launch {
            while (isActive && !stopping) {
                delay(500)
                if (System.currentTimeMillis() >= deadline || getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
                    stopNow("Sessão expirada ou aparelho bloqueado"); break
                }
                if (SystemClock.elapsedRealtime() - negotiationStarted > AuthorizationGate.LEASE_MILLIS && !gate.isFresh()) {
                    stopNow("Autorização de rede expirou"); break
                }
            }
        }
        telemetryJob = scope.launch {
            while (isActive && !stopping) {
                runCatching { api?.json("/device/heartbeat", DeviceTelemetry.heartbeat(applicationContext)) }
                delay(5000)
            }
        }
        authorityPoll = scope.launch {
            while (isActive && !stopping) {
                delay(3000)
                try {
                    val fresh = withTimeout(5000) { api!!.session(sessionId!!) }
                    if (fresh.status !in setOf("APPROVED", "CONNECTING", "ACTIVE")) { stopNow("Sessão encerrada pelo servidor"); break }
                    gate.renew(fresh.id, fresh.status, fresh.controlApproved)
                    HubRepository.update { it.copy(active = fresh, controlEnabled = gate.controlAllowed()) }
                } catch (_: Exception) { /* Independent watchdog stops sharing when the monotonic lease expires. */ }
            }
        }
    }
    fun suspendControl() {
        gate.suspendControl()
        HubRepository.update { it.copy(controlEnabled = false) }
        val id = sessionId ?: return
        HubRepository.record(id, "Controle suspenso localmente")
        scope.launch { runCatching { api?.json("/sessions/$id/control/revoke", JSONObject()) } }
    }
    fun approveControl() {
        if (stopping || AssistedAccessibilityService.instance == null) return
        val id = sessionId ?: return
        scope.launch {
            runCatching {
                val fresh = RemoteSession.fromJson(api!!.json("/sessions/$id/control/approve", JSONObject()))
                if (!stopping) {
                    gate.allowControl(); gate.renew(id, fresh.status, fresh.controlApproved)
                    HubRepository.update { it.copy(active = fresh, controlEnabled = gate.controlAllowed()) }
                    HubRepository.record(id, "Controle autorizado explicitamente no aparelho")
                }
            }.onFailure { HubRepository.error("Não foi possível autorizar o controle") }
        }
    }
    fun selectSource(uri: android.net.Uri?) { rtc?.files?.selectSource(uri) }
    fun acceptDestination(uri: android.net.Uri?) { rtc?.files?.acceptDestination(uri) }
    fun cancelFile() { rtc?.files?.cancel() }
    fun stopNow(reason: String) {
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            android.os.Handler(android.os.Looper.getMainLooper()).post { stopNow(reason) }; return
        }
        if (stopping) return
        stopping = true; gate.stop(); leaseJob?.cancel(); leaseJob = null; authorityPoll?.cancel(); authorityPoll = null; telemetryJob?.cancel(); telemetryJob = null
        runCatching { rtc?.close() }; rtc = null
        HubRepository.update { it.copy(active = null, controlEnabled = false, connection = reason, filePrompt = null, filePickRequested = false) }
        sessionId?.let { HubRepository.record(it, reason) }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        scope.launch {
            val id = sessionId
            if (id != null) runCatching { withTimeout(7000) { api?.end(id) } }
            stopSelf()
        }
    }
    override fun onDestroy() {
        gate.stop(); runCatching { rtc?.close() }; rtc = null
        if (receiverRegistered) unregisterReceiver(screenOff)
        if (current === this) current = null
        HubRepository.update { it.copy(active = null, controlEnabled = false) }
        scope.cancel(); super.onDestroy()
    }
}

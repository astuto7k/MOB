package com.androidremotehub.rtc

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.androidremotehub.data.HubApi
import com.androidremotehub.data.HubRepository
import com.androidremotehub.data.RemoteSession
import com.androidremotehub.files.SelectedFileTransfer
import com.androidremotehub.session.AssistedAccessibilityService
import com.androidremotehub.session.AuthorizationGate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.*
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

class RtcSession(
    private val context: Context,
    private val scope: CoroutineScope,
    private val api: HubApi,
    private val session: RemoteSession,
    private val gate: AuthorizationGate,
    private val onEnded: (String) -> Unit
) {
    private val main = Handler(Looper.getMainLooper())
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var source: VideoSource? = null
    private var helper: SurfaceTextureHelper? = null
    private var capturer: ConsentScreenCapturer? = null
    private var track: VideoTrack? = null
    private var peer: PeerConnection? = null
    private var signalJob: Job? = null
    private var remoteSet = false
    private val pendingIce = mutableListOf<IceCandidate>()
    private val closed = AtomicBoolean(false)
    private var controlChannel: DataChannel? = null
    private var fileChannel: DataChannel? = null
    val files = SelectedFileTransfer(context, scope, gate, api, session.id)
    private val observer = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            if (state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.CLOSED || state == PeerConnection.IceConnectionState.DISCONNECTED) {
                end("Conexão WebRTC interrompida. Uma nova sessão exige autorização.")
            }
        }
        override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
            if (state == PeerConnection.PeerConnectionState.CONNECTED) scope.launch {
                runCatching {
                    val active = RemoteSession.fromJson(api.json("/sessions/${session.id}/active", JSONObject()))
                    gate.renew(active.id, active.status, active.controlApproved)
                    HubRepository.update { it.copy(active = active, connection = "Transmitindo via WebRTC criptografado", controlEnabled = gate.controlAllowed()) }
                }.onFailure { end("Não foi possível confirmar a sessão ativa") }
            }
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidate(candidate: IceCandidate) {
            signal("ice", JSONObject().put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex))
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
        override fun onAddStream(stream: MediaStream?) {}
        override fun onRemoveStream(stream: MediaStream?) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
        override fun onDataChannel(channel: DataChannel) {
            main.post {
                if (closed.get()) { channel.close(); return@post }
                when (channel.label()) {
                    "control" -> {
                        if (controlChannel != null) { channel.close(); return@post }
                        controlChannel = channel
                        channel.registerObserver(channelObserver(channel, false))
                    }
                    "files" -> {
                        if (fileChannel != null) { channel.close(); return@post }
                        fileChannel = channel; files.bind(channel)
                        channel.registerObserver(channelObserver(channel, true))
                    }
                    else -> channel.close()
                }
            }
        }
    }
    private fun channelObserver(channel: DataChannel, isFiles: Boolean) = object : DataChannel.Observer {
        override fun onBufferedAmountChange(previousAmount: Long) {}
        override fun onStateChange() {
            if (isFiles && channel.state() == DataChannel.State.CLOSED) files.cancel("Canal de arquivos fechado", false)
        }
        override fun onMessage(buffer: DataChannel.Buffer) {
            if (closed.get()) return
            val remaining = buffer.data.remaining()
            if (remaining > if (buffer.binary) SelectedFileTransfer.CHUNK else 4096) { end("Mensagem de dados excedeu o limite"); return }
            val bytes = ByteArray(remaining); buffer.data.get(bytes)
            if (buffer.binary) {
                if (isFiles) files.onBinary(bytes)
                return
            }
            val j = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return
            if (isFiles) { files.onText(j); return }
            main.post {
                if (j.optString("type") == "quality") {
                    if (gate.isFresh()) setQuality(j.optString("profile") == "low")
                    return@post
                }
                val ok = AssistedAccessibilityService.instance?.dispatch(j, gate) == true
                val reply = JSONObject().put("type", "control-result").put("seq", j.optLong("seq", -1)).put("ok", ok)
                channel.send(DataChannel.Buffer(ByteBuffer.wrap(reply.toString().toByteArray()), false))
            }
        }
    }
    suspend fun prepare(consent: Intent) {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        val e = EglBase.create(); egl = e
        val f = PeerConnectionFactory.builder().setVideoEncoderFactory(DefaultVideoEncoderFactory(e.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(e.eglBaseContext)).createPeerConnectionFactory(); factory = f
        val video = f.createVideoSource(true); source = video
        val h = SurfaceTextureHelper.create("AuthorizedScreenCapture", e.eglBaseContext); helper = h
        val c = ConsentScreenCapturer(consent, { end("Compartilhamento interrompido pelo Android") }, { w, height -> video.adaptOutputFormat(w, height, 15) })
        capturer = c; c.initialize(h, context, video.capturerObserver); c.startCapture(720, 1280, 15)
        val ice = api.json("/sessions/${session.id}/ice").getJSONArray("iceServers")
        check(!closed.get()) { "Sessão já encerrada" }
        val servers = (0 until ice.length()).map { i ->
            val entry = ice.getJSONObject(i)
            val raw = entry.get("urls")
            val urls = if (raw is org.json.JSONArray) (0 until raw.length()).map { raw.getString(it) } else listOf(raw.toString())
            PeerConnection.IceServer.builder(urls).setUsername(entry.optString("username")).setPassword(entry.optString("credential")).createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(servers).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        peer = f.createPeerConnection(config, observer) ?: error("Não foi possível criar WebRTC")
        track = f.createVideoTrack("authorized-screen", video)
        val sender = peer!!.addTrack(track, listOf("screen"))
        val parameters = sender.parameters
        parameters.encodings.forEach { encoding -> encoding.maxBitrateBps = 1_500_000; encoding.maxFramerate = 15 }
        sender.parameters = parameters
    }
    fun connectSignaling() {
        gate.socket(true)
        signalJob = scope.launch {
            var lastSeq = 0
            runCatching {
                api.json("/sessions/${session.id}/signal", JSONObject().put("type", "join").put("sessionId", session.id))
            }
            while (isActive && !closed.get()) {
                try {
                    val data = api.json("/sessions/${session.id}/signal?after=$lastSeq")
                    val arr = data.optJSONArray("messages")
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            val msg = arr.getJSONObject(i)
                            val seq = msg.optInt("seq", 0)
                            if (seq > lastSeq) lastSeq = seq
                            main.post { handleSignal(msg) }
                        }
                    }
                    val sessObj = data.optJSONObject("session")
                    if (sessObj != null) {
                        val current = RemoteSession.fromJson(sessObj)
                        gate.renew(current.id, current.status, current.controlApproved)
                        if (current.status !in setOf("APPROVED", "CONNECTING", "ACTIVE")) {
                            end("Sessão encerrada: ${current.status}")
                            break
                        }
                    }
                } catch (_: Exception) {}
                delay(650)
            }
        }
    }
    private fun handleSignal(j: JSONObject) {
        if (closed.get() || j.optString("sessionId", session.id) != session.id) return
        when (j.optString("type")) {
            "offer" -> {
                val payload = j.optJSONObject("payload") ?: return
                val p = peer ?: return
                p.setRemoteDescription(object : SdpAdapter() {
                    override fun onSetSuccess() {
                        remoteSet = true
                        pendingIce.forEach { p.addIceCandidate(it) }; pendingIce.clear()
                        p.createAnswer(object : SdpAdapter() {
                            override fun onCreateSuccess(sdp: SessionDescription) {
                                p.setLocalDescription(object : SdpAdapter() {
                                    override fun onSetSuccess() { signal("answer", JSONObject().put("type", "answer").put("sdp", sdp.description)) }
                                    override fun onSetFailure(error: String) { end("Falha ao publicar resposta WebRTC") }
                                }, sdp)
                            }
                            override fun onCreateFailure(error: String) { end("Falha ao negociar resposta WebRTC") }
                        }, MediaConstraints())
                    }
                    override fun onSetFailure(error: String) { end("Oferta WebRTC inválida") }
                }, SessionDescription(SessionDescription.Type.OFFER, payload.getString("sdp")))
            }
            "ice" -> {
                val ice = j.optJSONObject("payload") ?: return
                val candStr = ice.optString("candidate")
                if (candStr.isBlank()) return
                val candidate = IceCandidate(ice.optString("sdpMid", "0"), ice.optInt("sdpMLineIndex", 0), candStr)
                if (remoteSet) peer?.addIceCandidate(candidate) else if (pendingIce.size < 64) pendingIce += candidate
            }
            "session" -> {
                val payload = j.optJSONObject("payload") ?: return
                val current = RemoteSession.fromJson(payload)
                gate.renew(current.id, current.status, current.controlApproved)
                HubRepository.update { it.copy(active = current, controlEnabled = gate.controlAllowed()) }
                if (current.status !in setOf("APPROVED", "CONNECTING", "ACTIVE")) end("Sessão encerrada: ${current.status}")
            }
            "error" -> end("Sinalização recusada pelo servidor")
        }
    }
    private fun signal(type: String, payload: JSONObject) {
        if (closed.get()) return
        scope.launch {
            runCatching {
                api.json("/sessions/${session.id}/signal", JSONObject().put("type", type).put("sessionId", session.id).put("payload", payload))
            }
        }
    }
    private fun setQuality(low: Boolean) {
        capturer?.setLowQuality(low)
        peer?.senders?.firstOrNull { it.track()?.kind() == "video" }?.let { sender ->
            val params = sender.parameters
            params.encodings.forEach { it.maxBitrateBps = if (low) 500_000 else 1_500_000; it.maxFramerate = 15 }
            sender.parameters = params
        }
    }
    private fun end(message: String) { if (!closed.get()) main.post { if (!closed.get()) onEnded(message) } }
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        gate.stop()
        files.cancel("Sessão encerrada")
        signalJob?.cancel(); signalJob = null
        controlChannel?.unregisterObserver(); controlChannel?.close(); controlChannel?.dispose(); controlChannel = null
        fileChannel?.unregisterObserver(); fileChannel?.close(); fileChannel?.dispose(); fileChannel = null
        peer?.close(); peer?.dispose(); peer = null
        capturer?.dispose(); capturer = null
        helper?.dispose(); helper = null
        track?.dispose(); track = null
        source?.dispose(); source = null
        factory?.dispose(); factory = null
        egl?.release(); egl = null
    }
    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {}
        override fun onSetFailure(error: String) {}
    }
}

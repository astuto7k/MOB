package com.androidremotehub.files

import android.app.KeyguardManager
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.androidremotehub.data.FilePrompt
import com.androidremotehub.data.HubApi
import com.androidremotehub.data.HubRepository
import com.androidremotehub.session.AuthorizationGate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.webrtc.DataChannel
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID

/** One bounded transfer. Android always chooses the SAF source or destination locally. */
class SelectedFileTransfer(
    private val context: Context,
    private val scope: CoroutineScope,
    private val gate: AuthorizationGate,
    private val api: HubApi,
    private val sessionId: String
) {
    companion object { const val MAX_BYTES = 20L * 1024 * 1024; const val CHUNK = 16 * 1024 }
    private var channel: DataChannel? = null
    private var offer: FilePrompt? = null
    private var temp: File? = null
    private var destination: Uri? = null
    private var output: FileOutputStream? = null
    private var bytes = 0L
    private var digest: MessageDigest? = null
    private var sender: Job? = null
    private var accepted = false
    @Volatile private var preparing = false
    fun bind(value: DataChannel) { channel = value }
    private fun authorized() = gate.canTransfer(!context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
    private fun send(j: JSONObject): Boolean = channel?.let {
        it.state() == DataChannel.State.OPEN && it.send(DataChannel.Buffer(ByteBuffer.wrap(j.toString().toByteArray()), false))
    } == true
    private fun message(type: String, id: String) = JSONObject().put("type", type).put("id", id)
    @Synchronized fun onText(j: JSONObject) {
        if (!authorized()) { cancel("Sessão sem autorização"); return }
        when (j.optString("type")) {
            "file-pick" -> if (offer == null && !preparing) HubRepository.update { it.copy(filePickRequested = true, fileMessage = "O painel pediu um arquivo. Escolha no aparelho para compartilhar.") }
            "file-offer" -> {
                if (offer != null || preparing) { send(message("file-cancel", j.optString("id"))); return }
                val id = j.optString("id")
                val size = j.optLong("size", -1)
                val hash = j.optString("sha256")
                val name = safeName(j.optString("name"))
                if (id.length !in 1..80 || size !in 1..MAX_BYTES || !hash.matches(Regex("[a-fA-F0-9]{64}")) || j.optString("direction") != "upload") {
                    send(message("file-cancel", id)); return
                }
                offer = FilePrompt(id, name, size, hash.lowercase(), "upload")
                HubRepository.update { it.copy(filePrompt = offer, fileMessage = "Autorize o destino no seletor do Android.") }
            }
            "file-accept" -> {
                val current = offer ?: return
                if (current.direction == "download" && current.id == j.optString("id") && !accepted) {
                    accepted = true
                    sender = scope.launch(Dispatchers.IO) { sendSelected(current) }
                }
            }
            "file-complete" -> {
                val current = offer ?: return
                if (current.direction == "upload" && current.id == j.optString("id")) finishUpload(current)
            }
            "file-result" -> {
                val current = offer ?: return
                if (current.id == j.optString("id") && current.direction == "download") {
                    val ok = j.optBoolean("ok")
                    audit(current, if (ok) "COMPLETED" else "FAILED")
                    cleanup(if (ok) "Arquivo entregue e integridade confirmada." else "O navegador recusou o arquivo.")
                }
            }
            "file-cancel" -> if (offer?.id == j.optString("id")) cancel("Transferência cancelada pelo painel", notify = false)
        }
    }
    @Synchronized fun onBinary(data: ByteArray) {
        val current = offer ?: return
        if (!authorized() || current.direction != "upload" || !accepted || data.size > CHUNK || bytes + data.size > current.size) {
            cancel("Bloco de arquivo inválido"); return
        }
        runCatching {
            output?.write(data) ?: error("Destino não autorizado")
            digest?.update(data); bytes += data.size
            HubRepository.update { it.copy(fileProgress = bytes.toFloat() / current.size) }
        }.onFailure { cancel("Falha ao receber o arquivo") }
    }
    @Synchronized fun acceptDestination(uri: Uri?) {
        val current = offer ?: return
        if (uri == null) { cancel("Escolha de destino cancelada"); return }
        if (!authorized() || current.direction != "upload" || accepted) { cancel("Sessão encerrada"); return }
        destination = uri
        scope.launch(Dispatchers.IO) {
            try {
                val limit = fetchLimit()
                synchronized(this@SelectedFileTransfer) {
                    check(offer === current && authorized() && !accepted) { "Transferência cancelada" }
                    check(current.size <= limit) { "Arquivo excede o limite configurado pelo proprietário" }
                    temp = File.createTempFile("arh-receive-", ".part", context.cacheDir)
                    output = FileOutputStream(temp)
                    digest = MessageDigest.getInstance("SHA-256"); bytes = 0; accepted = false
                }
                record(current, "REQUESTED")
                synchronized(this@SelectedFileTransfer) {
                    check(offer === current && authorized()) { "Transferência cancelada" }
                    accepted = true
                    HubRepository.update { it.copy(filePrompt = null, fileProgress = 0f, fileMessage = "Recebendo ${current.name}") }
                    check(send(message("file-accept", current.id))) { "Canal de arquivos indisponível" }
                }
            } catch (e: Exception) {
                if (offer === current) cancel(e.message?.take(120) ?: "Não foi possível confirmar a política e o destino")
            }
        }
    }
    fun selectSource(uri: Uri?) {
        HubRepository.update { it.copy(filePickRequested = false) }
        if (uri == null || !authorized()) { HubRepository.update { it.copy(fileMessage = "Seleção cancelada.") }; return }
        scope.launch(Dispatchers.IO) {
            try {
                synchronized(this@SelectedFileTransfer) {
                    check(offer == null && !preparing) { "Já existe uma transferência" }
                    preparing = true
                }
                HubRepository.update { it.copy(fileProgress = 0f, fileMessage = "Preparando arquivo selecionado…") }
                val limit = fetchLimit()
                check(preparing && authorized()) { "Transferência cancelada" }
                var name = "arquivo"
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) name = safeName(cursor.getString(0) ?: name)
                }
                val cache = File.createTempFile("arh-send-", ".part", context.cacheDir)
                temp = cache
                val hash = MessageDigest.getInstance("SHA-256")
                var size = 0L
                context.contentResolver.openInputStream(uri)?.use { input ->
                    cache.outputStream().use { out ->
                        val buffer = ByteArray(CHUNK)
                        while (true) {
                            val count = input.read(buffer); if (count < 0) break
                            check(authorized() && preparing) { "Autorização encerrada ou transferência cancelada" }
                            size += count; check(size <= limit) { "Limite de arquivo configurado excedido (máximo 20 MiB)" }
                            hash.update(buffer, 0, count); out.write(buffer, 0, count)
                        }
                    }
                } ?: error("Não foi possível ler o arquivo escolhido")
                check(size > 0) { "Arquivo vazio" }
                val current = FilePrompt(UUID.randomUUID().toString(), name, size, hash.digest().joinToString("") { "%02x".format(it) }, "download")
                synchronized(this@SelectedFileTransfer) { check(preparing && authorized()); offer = current; accepted = false; preparing = false }
                record(current, "REQUESTED")
                check(authorized() && offer === current)
                check(send(JSONObject().put("type", "file-offer").put("id", current.id).put("name", name).put("size", size).put("sha256", current.sha256).put("direction", "download")))
                HubRepository.update { it.copy(fileMessage = "Compartilhando arquivo escolhido: $name", fileProgress = 0f) }
            } catch (e: Exception) { cancel(e.message?.take(120) ?: "Falha ao preparar arquivo") }
        }
    }
    private suspend fun sendSelected(current: FilePrompt) {
        try {
            val cached = temp ?: error("Arquivo indisponível")
            cached.inputStream().use { input ->
                val buffer = ByteArray(CHUNK); var sent = 0L
                while (true) {
                    check(authorized() && offer?.id == current.id) { "Transferência sem autorização" }
                    val count = input.read(buffer); if (count < 0) break
                    var waited = 0
                    while ((channel?.bufferedAmount() ?: Long.MAX_VALUE) > 256 * 1024) {
                        delay(25); waited += 25
                        check(waited < 10_000 && authorized()) { "Canal sem resposta" }
                    }
                    val dc = channel ?: error("Canal fechado")
                    check(dc.send(DataChannel.Buffer(ByteBuffer.wrap(buffer.copyOf(count)), true))) { "Falha de envio" }
                    sent += count
                    HubRepository.update { it.copy(fileProgress = sent.toFloat() / current.size) }
                }
            }
            check(send(message("file-complete", current.id)))
        } catch (e: Exception) { cancel(e.message?.take(120) ?: "Transferência interrompida") }
    }
    @Synchronized private fun finishUpload(current: FilePrompt) {
        if (!accepted || output == null) { cancel("Transferência não autorizada"); return }
        output?.close(); output = null
        val hash = digest?.digest()?.joinToString("") { "%02x".format(it) }
        if (bytes != current.size || hash != current.sha256 || !authorized()) {
            send(message("file-result", current.id).put("ok", false).put("error", "Integrity or authorization failure"))
            audit(current, "FAILED"); cleanup("Arquivo recusado: integridade ou autorização inválida.")
            return
        }
        scope.launch(Dispatchers.IO) {
            try {
                check(authorized())
                context.contentResolver.openOutputStream(destination ?: error("Sem destino"), "wt")?.use { out ->
                    temp?.inputStream()?.use { input ->
                        val buffer = ByteArray(CHUNK)
                        while (true) {
                            check(authorized())
                            val n = input.read(buffer); if (n < 0) break
                            out.write(buffer, 0, n)
                        }
                    } ?: error("Arquivo temporário ausente")
                } ?: error("Destino não gravável")
                send(message("file-result", current.id).put("ok", true)); audit(current, "COMPLETED")
                destination = null // Keep the explicitly chosen, successfully verified document.
                cleanup("Arquivo salvo. Integridade SHA-256 confirmada.")
            } catch (_: Exception) {
                send(message("file-result", current.id).put("ok", false).put("error", "Write failed"))
                audit(current, "FAILED"); cleanup("Falha ao salvar o arquivo.")
            }
        }
    }
    fun cancel(reason: String = "Transferência cancelada", notify: Boolean = true) {
        val current = offer
        if (current != null) {
            if (notify) send(message("file-cancel", current.id))
            audit(current, "CANCELED")
        }
        sender?.cancel(); sender = null
        cleanup(reason)
    }
    @Synchronized private fun cleanup(message: String) {
        runCatching { output?.close() }; output = null
        temp?.delete(); temp = null
        destination?.let { uri -> runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) } }; destination = null
        offer = null; accepted = false; preparing = false; bytes = 0; digest = null
        HubRepository.update { it.copy(filePrompt = null, filePickRequested = false, fileProgress = null, fileMessage = message) }
    }
    private suspend fun fetchLimit(): Long {
        val policy = com.androidremotehub.data.DevicePolicy.fromJson(api.json("/device/policy"))
        HubRepository.policyObserved(api.identity, policy)
        return minOf(MAX_BYTES, policy.maxFileBytes)
    }
    private suspend fun record(current: FilePrompt, status: String) {
        api.json("/files", JSONObject().put("sessionId", sessionId)
            .put("direction", if (current.direction == "upload") "TO_DEVICE" else "FROM_DEVICE")
            .put("name", current.name).put("size", current.size).put("sha256", current.sha256).put("status", status))
    }
    private fun audit(current: FilePrompt, status: String) {
        scope.launch { runCatching { record(current, status) } }
    }
    private fun safeName(raw: String) = raw.map { if (it == '/' || it.code == 92 || it.isISOControl()) '_' else it }.joinToString("").take(140).ifBlank { "arquivo" }
}

package com.androidremotehub.data

import android.os.Build
import com.androidremotehub.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : Exception(message)
class HubApi(val identity: DeviceIdentity) {
    companion object {
        val client = OkHttpClient.Builder().connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS).callTimeout(7, TimeUnit.SECONDS)
            .followRedirects(true).followSslRedirects(true).build()

        val BUILTIN_SERVERS = listOf(
            "http://192.168.0.9:3000",
            "http://192.168.0.9:3001",
            "https://mob-gamma.vercel.app",
            "https://mob-astuto7k.vercel.app",
            "https://mob-astuto7ks-projects.vercel.app",
            "https://mob-git-main-astuto7ks-projects.vercel.app",
            "https://mob.vercel.app",
            "http://10.0.2.2:3000",
            "http://127.0.0.1:3000"
        )

        private fun isLocalOrLanHost(host: String): Boolean {
            val h = host.lowercase(java.util.Locale.ROOT)
            if (h in setOf("10.0.2.2", "localhost", "127.0.0.1") || h.endsWith(".local")) return true
            if (h.startsWith("192.168.") || h.startsWith("10.") || h.startsWith("127.")) return true
            val parts = h.split(".")
            if (parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 }) {
                val first = parts[0].toInt()
                val second = parts[1].toInt()
                if (first == 172 && second in 16..31) return true
            }
            return false
        }

        fun validateServer(raw: String): String {
            var trimmed = raw.trim().trimEnd('/')
            require(trimmed.isNotEmpty()) { "Informe o endereço do servidor" }
            if (!trimmed.startsWith("http://", ignoreCase = true) && !trimmed.startsWith("https://", ignoreCase = true)) {
                val hostPart = trimmed.substringBefore("/").substringBefore(":")
                trimmed = if (isLocalOrLanHost(hostPart)) "http://$trimmed" else "https://$trimmed"
            }
            val parsed = trimmed.toHttpUrl()
            val targetUrl = parsed.newBuilder().encodedPath("/").query(null).fragment(null).build()
            return targetUrl.toString().trimEnd('/')
        }

        private fun fetchRemoteCandidateServers(): List<String> {
            return runCatching {
                val req = Request.Builder()
                    .url("https://raw.githubusercontent.com/astuto7k/MOB/main/server-config.json")
                    .build()
                client.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) return emptyList()
                    val arr = JSONObject(r.body.string()).optJSONArray("servers") ?: return emptyList()
                    (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotBlank() } }
                }
            }.getOrDefault(emptyList())
        }

        suspend fun inspectServer(raw: String): String = withContext(Dispatchers.IO) {
            val server = validateServer(raw)
            client.newCall(Request.Builder().url("$server/api/v1/health").build()).execute().use { response ->
                check(response.isSuccessful) { "O servidor não respondeu (${response.code})" }
                val cert = response.handshake?.peerCertificates?.firstOrNull()
                if (cert == null) "Servidor local conectado (${server.toHttpUrl().host}:${server.toHttpUrl().port})."
                else "HTTPS validado para ${server.toHttpUrl().host}. Certificado SHA-256: " +
                    MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(":") { "%02X".format(it) }
            }
        }

        suspend fun autoPair(server: String, name: String, publicKey: String): DeviceIdentity = withContext(Dispatchers.IO) {
            val base = validateServer(server)
            val fullName = if (name.lowercase(java.util.Locale.ROOT).contains(Build.MANUFACTURER.lowercase(java.util.Locale.ROOT))) {
                name.trim()
            } else {
                "${Build.MANUFACTURER} ${name.trim()}".trim()
            }
            val payload = JSONObject()
                .put("name", fullName.take(80))
                .put("manufacturer", Build.MANUFACTURER.take(80))
                .put("model", Build.MODEL.take(100))
                .put("androidVersion", Build.VERSION.RELEASE.take(40))
                .put("appVersion", BuildConfig.VERSION_NAME.take(40))
                .put("publicKey", publicKey)
            val request = Request.Builder()
                .url("$base/api/v1/pairing/auto")
                .post(payload.toString().toRequestBody("application/json".toMediaType()))
                .build()
            client.newCall(request).execute().use { r ->
                val j = parse(r.code, r.body.string())
                val d = j.getJSONObject("device")
                DeviceIdentity(base, d.getString("id"), d.getString("name"), j.getString("token"))
            }
        }

        suspend fun autoDiscoverAndPair(publicKey: String, preferredServer: String? = null): DeviceIdentity = withContext(Dispatchers.IO) {
            val candidates = LinkedHashSet<String>()
            if (!preferredServer.isNullOrBlank()) {
                runCatching { candidates.add(validateServer(preferredServer)) }
            }
            fetchRemoteCandidateServers().forEach { s -> runCatching { candidates.add(validateServer(s)) } }
            BUILTIN_SERVERS.forEach { s -> runCatching { candidates.add(validateServer(s)) } }
            var lastError: Exception? = null
            for (candidate in candidates) {
                try {
                    return@withContext autoPair(candidate, Build.MODEL, publicKey)
                } catch (e: Exception) {
                    lastError = e
                }
            }
            throw lastError ?: IllegalStateException("Nenhum servidor disponível no momento")
        }

        suspend fun pair(server: String, code: String, name: String, publicKey: String): DeviceIdentity = withContext(Dispatchers.IO) {
            if (code.isBlank()) return@withContext autoPair(server, name, publicKey)
            val base = validateServer(server)
            val payload = JSONObject().put("code", code.trim().uppercase(java.util.Locale.ROOT).replace("-", "").filterNot { it.isWhitespace() }).put("name", name.trim())
                .put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL)
                .put("androidVersion", Build.VERSION.RELEASE).put("appVersion", BuildConfig.VERSION_NAME).put("publicKey", publicKey)
            val request = Request.Builder().url("$base/api/v1/pairing/confirm").post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            client.newCall(request).execute().use { r ->
                val j = parse(r.code, r.body.string())
                val d = j.getJSONObject("device")
                DeviceIdentity(base, d.getString("id"), d.getString("name"), j.getString("token"))
            }
        }
        private fun parse(status: Int, body: String): JSONObject {
            if (status !in 200..299) {
                val message = runCatching { JSONObject(body).optString("message") }.getOrDefault("")
                throw ApiException(status, message.take(240).ifBlank { "Falha no servidor ($status)" })
            }
            return if (body.isBlank()) JSONObject() else JSONObject(body)
        }
    }
    fun request(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): Request {
        val b = Request.Builder().url("${identity.serverUrl}/api/v1$path").header("Authorization", "Bearer ${identity.token}")
        if (method != "GET") b.method(method, (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        return b.build()
    }
    suspend fun json(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject = withContext(Dispatchers.IO) {
        client.newCall(request(path, body, method)).execute().use { r -> parse(r.code, r.body.string()) }
    }
    suspend fun requests(): List<RemoteSession> = withContext(Dispatchers.IO) {
        client.newCall(request("/device/requests")).execute().use { r ->
            val body = r.body.string()
            if (!r.isSuccessful) parse(r.code, body)
            val list = JSONArray(body)
            (0 until list.length()).map { RemoteSession.fromJson(list.getJSONObject(it)) }
        }
    }
    suspend fun session(id: String) = RemoteSession.fromJson(json("/sessions/$id"))
    suspend fun end(id: String) = json("/sessions/$id/end", JSONObject())
    suspend fun revoke() = json("/device/revoke", JSONObject())
}

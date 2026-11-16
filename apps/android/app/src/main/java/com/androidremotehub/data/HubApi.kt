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
        val client = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS).callTimeout(7, TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false).build()
        fun validateServer(raw: String): String {
            val u = raw.trim().trimEnd('/').toHttpUrl()
            require(u.username.isEmpty() && u.password.isEmpty() && u.encodedQuery == null && u.fragment == null) { "Informe apenas a origem do servidor" }
            require(u.encodedPath == "/") { "Use a origem HTTPS sem caminho /api" }
            val localDebug = BuildConfig.DEBUG && u.scheme == "http" && u.host in setOf("10.0.2.2", "localhost", "127.0.0.1")
            require(u.scheme == "https" || localDebug) { "HTTPS é obrigatório. HTTP só é permitido no emulador/localhost em debug" }
            return u.toString().trimEnd('/')
        }
        suspend fun inspectServer(raw: String): String = withContext(Dispatchers.IO) {
            val server = validateServer(raw)
            client.newCall(Request.Builder().url("$server/api/v1/health").build()).execute().use { response ->
                check(response.isSuccessful) { "O servidor não respondeu ao diagnóstico HTTPS (${response.code})" }
                val cert = response.handshake?.peerCertificates?.firstOrNull()
                if (cert == null) "Desenvolvimento local sem TLS. Nunca use pela internet."
                else "HTTPS validado para ${server.toHttpUrl().host}. Certificado SHA-256: " +
                    MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(":") { "%02X".format(it) }
            }
        }
        suspend fun pair(server: String, code: String, name: String, publicKey: String): DeviceIdentity = withContext(Dispatchers.IO) {
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

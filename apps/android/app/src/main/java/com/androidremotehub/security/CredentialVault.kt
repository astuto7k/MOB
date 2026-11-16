package com.androidremotehub.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.androidremotehub.data.DeviceIdentity
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only encrypted credential bytes are persisted. Keys stay non-exportable in Android Keystore. */
class CredentialVault(context: Context) {
    private val prefs = context.getSharedPreferences("arh.credentials", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val aesAlias = "arh.credential.encryption.v1"
    private val identityAlias = "arh.device.identity.v1"
    private fun aesKey(): SecretKey {
        (keyStore.getKey(aesAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(aesAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    fun publicIdentity(): String {
        if (!keyStore.containsAlias(identityAlias)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(identityAlias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setDigests(KeyProperties.DIGEST_SHA256).build())
            }.generateKeyPair()
        }
        return Base64.encodeToString(keyStore.getCertificate(identityAlias).publicKey.encoded, Base64.NO_WRAP)
    }
    fun save(identity: DeviceIdentity) {
        val raw = JSONObject().put("serverUrl", identity.serverUrl).put("deviceId", identity.deviceId)
            .put("name", identity.name).put("token", identity.token).toString().toByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, aesKey()) }
        val ciphertext = cipher.doFinal(raw)
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
        check(prefs.edit().putString("sealed", encoded).commit()) { "Não foi possível salvar a credencial" }
        raw.fill(0)
    }
    fun load(): DeviceIdentity? {
        val encoded = prefs.getString("sealed", null) ?: return null
        return try {
            val all = Base64.decode(encoded, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, aesKey(), GCMParameterSpec(128, all.copyOfRange(0, 12)))
            }
            val plain = cipher.doFinal(all.copyOfRange(12, all.size))
            val j = JSONObject(String(plain, Charsets.UTF_8)); plain.fill(0)
            DeviceIdentity(j.getString("serverUrl"), j.getString("deviceId"), j.getString("name"), j.getString("token"))
        } catch (_: Exception) {
            prefs.edit().clear().commit()
            null // Never silently fall back to unencrypted credentials.
        }
    }
    fun clear() {
        prefs.edit().clear().commit()
        if (keyStore.containsAlias(identityAlias)) keyStore.deleteEntry(identityAlias)
    }
}

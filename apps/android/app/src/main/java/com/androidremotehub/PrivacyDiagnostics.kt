package com.androidremotehub

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.androidremotehub.data.ApiException
import com.androidremotehub.data.DevicePolicy
import com.androidremotehub.data.HubApi
import com.androidremotehub.data.HubRepository
import com.androidremotehub.data.HubUiState
import com.androidremotehub.session.AssistedAccessibilityService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.IOException
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.SSLException

private data class LocalStatus(val notifications: Boolean, val accessibility: Boolean, val network: String, val internetValidated: Boolean)

private fun localStatus(context: Context): LocalStatus {
    val runtimeGranted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val cm = context.getSystemService(ConnectivityManager::class.java)
    val capabilities = cm.getNetworkCapabilities(cm.activeNetwork)
    val network = when {
        capabilities == null -> "Sem rede ativa"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN configurada no sistema"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Dados móveis"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
        else -> "Outro transporte"
    }
    return LocalStatus(runtimeGranted && NotificationManagerCompat.from(context).areNotificationsEnabled(),
        AssistedAccessibilityService.instance != null, network,
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
}

fun formatFileLimit(bytes: Long): String {
    val numbers = NumberFormat.getNumberInstance(Locale.forLanguageTag("pt-BR"))
    numbers.maximumFractionDigits = 2
    return "${numbers.format(bytes / 1048576.0)} MiB (${numbers.format(bytes)} bytes)"
}

private fun observedTime(value: String): String = runCatching {
    val parsed = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(value)
    if (parsed != null) SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.getDefault()).format(parsed) else value
}.getOrDefault(value)

private fun diagnosticError(error: Exception): String = when (error) {
    is ApiException -> if (error.status == 401 || error.status == 403) "A API não autorizou a consulta da política (HTTP ${error.status}). Confira o pareamento."
        else "A API não confirmou a consulta (HTTP ${error.status})."
    is SSLException -> "A conexão HTTPS ou o certificado não pôde ser validado. A verificação TLS permanece obrigatória."
    is IOException -> "Não foi possível concluir pela rede. Confira internet e disponibilidade do servidor."
    is IllegalArgumentException -> "Informe somente uma origem HTTPS válida, sem caminho, credenciais ou parâmetros."
    else -> "O diagnóstico não foi concluído. Confira o servidor e tente novamente; nenhum acesso remoto foi iniciado."
}

@Composable
fun PrivacyDiagnosticsDialog(state: HubUiState, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var local by remember { mutableStateOf(localStatus(context)) }
    var serverDraft by rememberSaveable { mutableStateOf("http://192.168.0.9:3001") }
    var busy by remember { mutableStateOf(false) }
    var httpsResult by remember { mutableStateOf<String?>(null) }
    var policyResult by remember { mutableStateOf<String?>(null) }
    var testedAt by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    val identity = state.identity
    val target = identity?.serverUrl ?: serverDraft
    DisposableEffect(lifecycle, context) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) local = localStatus(context) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(shape = RoundedCornerShape(20.dp), modifier = Modifier.padding(16.dp).widthIn(max = 560.dp).fillMaxWidth()) {
            Column(Modifier.heightIn(max = 720.dp).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Privacidade e diagnóstico", style = MaterialTheme.typography.headlineSmall)
                Text("Informações desta instalação e verificações iniciadas por você. O diagnóstico não solicita captura nem concede controle.", style = MaterialTheme.typography.bodyMedium)
                DiagnosticCard("Esta instalação", "Android Remote Hub ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\nPacote: ${BuildConfig.APPLICATION_ID}\nBuild: ${BuildConfig.BUILD_TYPE}\nAndroid ${Build.VERSION.RELEASE} • API ${Build.VERSION.SDK_INT}\nModo: ${if (BuildConfig.FLAVOR == "firebase") "Firebase — suporte opcional; entrega de push não testada aqui" else "Standalone — pedidos com app aberto"}")
                DiagnosticCard("Permissões e rede observadas", "Notificações: ${if (local.notifications) "permitidas no sistema" else "não disponíveis ou desativadas"}\nAcessibilidade: ${if (local.accessibility) "serviço ativo" else "serviço não ativo"}\nRede ativa: ${local.network}\nInternet validada pelo Android: ${if (local.internetValidated) "sim" else "não"}\nCompartilhamento: ${state.active?.status ?: "nenhuma sessão ativa"}\nControle: ${if (state.controlEnabled) "autorizado na sessão atual" else "não autorizado"}")
                OutlinedButton(onClick = { local = localStatus(context) }, modifier = Modifier.fillMaxWidth()) { Text("Atualizar informações locais") }
                DiagnosticCard("Servidor e estado", "Servidor pareado: ${identity?.serverUrl ?: "nenhum"}\nEstado informado pelo app: ${state.connection}\nHTTPS/health não prova funcionamento de WebSocket, ICE ou TURN. Este botão não testa esses canais.")
                if (identity == null) {
                    OutlinedTextField(serverDraft, { serverDraft = it; httpsResult = null; failure = null }, label = { Text("Servidor HTTPS para diagnóstico") }, placeholder = { Text("https://painel.exemplo.com") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                    Text("Antes do pareamento, só a origem informada e a rota pública de saúde serão consultadas. Política exige a credencial do aparelho pareado.", style = MaterialTheme.typography.bodySmall)
                } else Text("A consulta usa somente a credencial já pareada no servidor acima. Não envia tela, arquivos, inventário de aplicativos ou conteúdo privado.", style = MaterialTheme.typography.bodySmall)
                Button(enabled = !busy && target.isNotBlank(), onClick = {
                    val requestedIdentity = identity
                    val requestedTarget = target
                    busy = true; httpsResult = null; policyResult = null; failure = null; testedAt = null
                    scope.launch {
                        try {
                            httpsResult = HubApi.inspectServer(requestedTarget)
                            if (requestedIdentity != null) {
                                val policy = DevicePolicy.fromJson(HubApi(requestedIdentity).json("/device/policy"))
                                HubRepository.policyObserved(requestedIdentity, policy)
                                policyResult = "Consulta autorizada: ${formatFileLimit(policy.maxFileBytes)} por arquivo; até ${policy.maxSessionMinutes} minutos por nova sessão. Os valores podem mudar no servidor e são conferidos novamente no fluxo da operação."
                            } else policyResult = "Política não consultada: nenhum aparelho pareado."
                        } catch (error: CancellationException) { throw error }
                        catch (error: Exception) { failure = diagnosticError(error) }
                        finally { testedAt = SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.getDefault()).format(Date()); busy = false; local = localStatus(context) }
                    }
                }, modifier = Modifier.fillMaxWidth()) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Text(if (identity == null) "Testar HTTPS" else "Testar HTTPS e política")
                }
                httpsResult?.let { DiagnosticCard("Resultado HTTPS observado", it) }
                policyResult?.let { DiagnosticCard("Política", it) }
                failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                testedAt?.let { Text("Última tentativa: ${observedTime(it)}", style = MaterialTheme.typography.bodySmall) }
                if (identity != null && state.policy != null && policyResult == null) DiagnosticCard("Última política consultada", "${formatFileLimit(state.policy.maxFileBytes)} por arquivo; até ${state.policy.maxSessionMinutes} minutos por sessão.\n${state.policyCheckedAt?.let(::observedTime) ?: "Horário indisponível"}\nÉ um resultado anterior, não uma validação atual.")
                DiagnosticCard("O que o app compartilha", "Apenas uma tela autorizada por sessão e arquivos escolhidos no seletor Android. Conteúdo privado visível pode aparecer na tela: feche conversas, bancos e autenticadores antes de aceitar. Não há filtro universal automático. Você pode encerrar pela notificação ou pelo app.")
                DiagnosticCard("Atualização manual do próprio app", "Use somente um APK Android Remote Hub obtido do seu projeto ou canal controlado pelo proprietário. Confira versão, pacote e assinatura conforme o guia de instalação. A mesma assinatura é necessária para atualizar uma instalação existente. APK debug é de desenvolvimento.\nEste app não se apresenta como Google Play, não instala outros pacotes e não precisa de VPN para atualizar. A instalação é uma decisão sua no fluxo oficial do Android.")
                TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("Fechar diagnóstico") }
            }
        }
    }
}

@Composable private fun DiagnosticCard(title: String, body: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

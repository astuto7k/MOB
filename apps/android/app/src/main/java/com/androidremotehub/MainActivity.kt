package com.androidremotehub

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.androidremotehub.data.*
import com.androidremotehub.session.AssistedAccessibilityService
import com.androidremotehub.session.SharingService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class MainActivity : ComponentActivity() {
    private var pendingSession: String? = null
    private var pendingControl = false
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val openDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> SharingService.current?.selectSource(uri) }
    private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri -> SharingService.current?.acceptDestination(uri) }
    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingSession
        pendingSession = null
        if (id != null && result.resultCode == Activity.RESULT_OK && result.data != null) {
            val intent = Intent(this, SharingService::class.java).putExtra(SharingService.EXTRA_SESSION, id)
                .putExtra(SharingService.EXTRA_CONTROL, pendingControl).putExtra(SharingService.EXTRA_CONSENT, result.data)
            ContextCompat.startForegroundService(this, intent)
        } else if (id != null) {
            HubRepository.record(id, "Consentimento de tela recusado")
            lifecycleScope.launch { HubRepository.state.value.identity?.let { identity -> runCatching { HubApi(identity).json("/sessions/$id/reject", JSONObject()) } } }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingSession = savedInstanceState?.getString("pendingSession")
        pendingControl = savedInstanceState?.getBoolean("pendingControl") ?: false
        setContent {
            val colors = darkColorScheme(primary = Color(0xFF6CE9C0), background = Color(0xFF0B1020), surface = Color(0xFF151D30), onSurface = Color(0xFFEEF4FF), secondary = Color(0xFF8DA9E8))
            MaterialTheme(colorScheme = colors, shapes = Shapes(medium = RoundedCornerShape(18.dp))) {
                Surface(Modifier.fillMaxSize()) { HubScreen() }
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var previous = emptySet<String>()
                var consecutiveFailures = 0
                while (true) {
                    var identity = HubRepository.state.value.identity
                    if (identity == null) {
                        runCatching {
                            HubApi.autoDiscoverAndPair(HubRepository.vault.publicIdentity())
                        }.onSuccess { paired ->
                            identity = paired
                            HubRepository.paired(paired)
                            com.androidremotehub.notifications.NotificationIntegration.initialize(this@MainActivity)
                        }
                    }
                    if (identity != null) {
                        try {
                            val api = HubApi(identity!!)
                            api.json("/device/heartbeat", DeviceTelemetry.heartbeat(this@MainActivity))
                            val requests = api.requests()
                            if (requests.any { it.id !in previous }) HubNotifications.request(this@MainActivity, identity!!.name)
                            previous = requests.map { it.id }.toSet()
                            consecutiveFailures = 0
                            HubRepository.update { it.copy(requests = requests, connection = if (it.active == null) "Conectado • visível no painel (${identity!!.serverUrl})" else it.connection, error = null) }
                        } catch (e: ApiException) {
                            consecutiveFailures++
                            if (e.status == 401 || e.status == 403 || consecutiveFailures >= 2) {
                                runCatching {
                                    HubApi.autoDiscoverAndPair(HubRepository.vault.publicIdentity(), identity?.serverUrl)
                                }.onSuccess { rePaired ->
                                    HubRepository.paired(rePaired)
                                    consecutiveFailures = 0
                                }
                            }
                        } catch (_: Exception) {
                            consecutiveFailures++
                            if (consecutiveFailures >= 2) {
                                runCatching {
                                    HubApi.autoDiscoverAndPair(HubRepository.vault.publicIdentity())
                                }.onSuccess { rePaired ->
                                    HubRepository.paired(rePaired)
                                    consecutiveFailures = 0
                                }
                            }
                            HubRepository.update { it.copy(connection = "Reconectando automaticamente ao painel…") }
                        }
                    }
                    delay(2500)
                }
            }
        }
    }
    override fun onResume() {
        super.onResume()
        HubRepository.update { it.copy(accessibilityEnabled = AssistedAccessibilityService.instance != null) }
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("pendingSession", pendingSession); outState.putBoolean("pendingControl", pendingControl)
        super.onSaveInstanceState(outState)
    }
    private fun requestSharing(session: RemoteSession, control: Boolean) {
        if (pendingSession != null || SharingService.current != null) return
        pendingSession = session.id; pendingControl = control
        val manager = getSystemService(MediaProjectionManager::class.java)
        val intent = if (Build.VERSION.SDK_INT >= 34) manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay()) else manager.createScreenCaptureIntent()
        capture.launch(intent)
    }
    @Composable private fun HubScreen() {
        val state by HubRepository.state.collectAsStateWithLifecycle()
        var tab by rememberSaveable { mutableIntStateOf(0) }
        var diagnostics by rememberSaveable { mutableStateOf(false) }
        if (diagnostics) PrivacyDiagnosticsDialog(state) { diagnostics = false }
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Column(Modifier.padding(24.dp, 24.dp, 24.dp, 18.dp)) {
                Text("ANDROID / REMOTE HUB", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(12.dp))
                Text(if (state.identity == null) "${Build.MANUFACTURER} ${Build.MODEL}" else state.identity!!.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(if (state.identity == null) "Conectando automaticamente ao painel…" else state.connection, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { diagnostics = true }) { Text("Privacidade e diagnóstico") }
            }
            state.error?.let { error ->
                Card(Modifier.padding(horizontal = 20.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF422938))) {
                    Text(error, Modifier.padding(16.dp))
                    TextButton(onClick = { HubRepository.error(null) }, modifier = Modifier.padding(start = 8.dp)) { Text("Fechar alerta") }
                }
            }
            if (state.identity == null) PairingScreen()
            else {
                PrimaryTabRow(selectedTabIndex = tab) {
                    listOf("Assistência", "Histórico", "Ajustes").forEachIndexed { index, title -> Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title) }) }
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    when (tab) {
                        0 -> SessionScreen(state)
                        1 -> HistoryScreen(state)
                        2 -> SettingsScreen(state)
                    }
                }
            }
        }
    }
    @Composable private fun PairingScreen() {
        val scope = rememberCoroutineScope()
        var server by rememberSaveable { mutableStateOf("http://192.168.0.9:3000") }
        var name by rememberSaveable { mutableStateOf("${Build.MANUFACTURER} ${Build.MODEL}".trim()) }
        var busy by remember { mutableStateOf(false) }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.5.dp)
                    Column {
                        Text("Conexão Automática Ativa", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text("Buscando o painel automaticamente (Rede Local e Vercel)… Assim que encontrar, este aparelho aparece no painel na hora.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            InfoCard("Ou informe a URL do seu painel (Vercel / IP)", "Se você subiu o painel na Vercel (ex.: https://seu-projeto.vercel.app), digite ou cole o link abaixo e toque em Conectar Agora. Não precisa de código!")
            OutlinedTextField(server, { server = it }, label = { Text("URL do Painel (Vercel ou IP Local)") }, placeholder = { Text("https://seu-painel.vercel.app") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(name, { name = it.take(80) }, label = { Text("Nome deste Android") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(enabled = server.isNotBlank() && name.isNotBlank() && !busy, onClick = {
                busy = true
                scope.launch {
                    runCatching { HubApi.autoPair(server, name, HubRepository.vault.publicIdentity()) }
                        .onSuccess { identity -> HubRepository.paired(identity); com.androidremotehub.notifications.NotificationIntegration.initialize(this@MainActivity) }
                        .onFailure { HubRepository.error(it.message ?: "Não foi possível conectar a este endereço") }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("Conectar Agora (Sem Código)")
            }
        }
    }
    @Composable private fun SessionScreen(state: HubUiState) {
        val active = state.active
        if (active == null) {
            InfoCard("Aparelho Visível no Painel!", "Este Android (${state.identity?.name}) já está conectado e visível no seu painel. Para transmitir a tela, clique em 'Solicitar assistência' no painel web.")
            if (state.requests.isEmpty()) InfoCard("Pronto para receber solicitações", "Nenhuma solicitação pendente no momento.")
            state.requests.forEach { request ->
                var allowControl by remember(request.id) { mutableStateOf(request.requestedControl && state.accessibilityEnabled) }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Pedido de assistência recebido", style = MaterialTheme.typography.titleLarge)
                        Text("Modalidade: ${if (request.requestedControl) "visualização e controle opcional" else "somente visualização"}\nExpira: ${prettyDate(request.expiresAt)}")
                        if (request.requestedControl) {
                            Row {
                                Checkbox(checked = allowControl, enabled = state.accessibilityEnabled, onCheckedChange = { allowControl = it })
                                Text("Autorizo controle nesta sessão.", Modifier.padding(top = 12.dp))
                            }
                            if (!state.accessibilityEnabled) Text("Você pode compartilhar a tela normalmente agora (somente visualização).")
                        }
                        Button(onClick = { requestSharing(request, allowControl) }, modifier = Modifier.fillMaxWidth()) { Text("Iniciar transmissão da tela") }
                        OutlinedButton(onClick = {
                            lifecycleScope.launch {
                                runCatching { HubApi(state.identity!!).json("/sessions/${request.id}/reject", JSONObject()) }
                                    .onSuccess { HubRepository.record(request.id, "Pedido recusado localmente"); HubRepository.update { it.copy(requests = it.requests.filterNot { r -> r.id == request.id }) } }
                                    .onFailure { HubRepository.error("Não foi possível recusar.") }
                            }
                        }, modifier = Modifier.fillMaxWidth()) { Text("Recusar solicitação") }
                    }
                }
            }
        } else {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF173F37)), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Sua tela está compartilhada", style = MaterialTheme.typography.titleLarge)
                    Text("Estado: ${active.status}\n${if (state.controlEnabled) "Controle autorizado nesta sessão" else "Somente visualização"}\nTermina até: ${prettyDate(active.expiresAt)}")
                    Button(onClick = { SharingService.current?.stopNow("Encerrada localmente pelo proprietário") }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF7186), contentColor = Color(0xFF160A0F)), modifier = Modifier.fillMaxWidth()) { Text("Encerrar compartilhamento agora") }
                    if (state.controlEnabled) OutlinedButton(onClick = { SharingService.current?.suspendControl() }, modifier = Modifier.fillMaxWidth()) { Text("Suspender controle imediatamente") }
                    else if (active.requestedControl && state.accessibilityEnabled) {
                        OutlinedButton(onClick = { SharingService.current?.approveControl() }, modifier = Modifier.fillMaxWidth()) { Text("Autorizar controle nesta sessão") }
                    }
                }
            }
            var assistanceText by rememberSaveable(active.id) { mutableStateOf("") }
            OutlinedTextField(assistanceText, { assistanceText = it.take(256) }, label = { Text("Campo de teste: texto não sensível") }, modifier = Modifier.fillMaxWidth())
            val fileLimit = state.policy?.let { "Último limite consultado: ${formatFileLimit(it.maxFileBytes)} por arquivo." }
                ?: "Máximo de 20 MiB por arquivo."
            InfoCard("Arquivos escolhidos por você", "Envie ou receba arquivos pelo canal seguro WebRTC. $fileLimit")
            state.filePrompt?.let { file ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Arquivo recebido: ${file.name}", style = MaterialTheme.typography.titleMedium)
                        Text("${file.size} bytes • confirme o destino para aceitar")
                        Button(onClick = { createDocument.launch(file.name) }, modifier = Modifier.fillMaxWidth()) { Text("Escolher destino e aceitar") }
                        TextButton(onClick = { SharingService.current?.cancelFile() }) { Text("Recusar arquivo") }
                    }
                }
            }
            if (state.filePickRequested) Text("O painel pediu um arquivo. Se desejar, escolha abaixo.", color = MaterialTheme.colorScheme.primary)
            OutlinedButton(onClick = { openDocument.launch(arrayOf("*/*")) }, enabled = state.fileProgress == null, modifier = Modifier.fillMaxWidth()) { Text("Escolher arquivo para compartilhar") }
            state.fileProgress?.let { progress ->
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { SharingService.current?.cancelFile() }) { Text("Cancelar transferência") }
            }
            state.fileMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
    @Composable private fun HistoryScreen(state: HubUiState) {
        InfoCard("Registro local", "Até 100 eventos de autorização e encerramento.")
        if (state.history.isEmpty()) Text("Nenhuma sessão registrada neste aparelho.")
        state.history.forEach { entry ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(entry.event, fontWeight = FontWeight.Medium)
                    Text(prettyDate(entry.at), style = MaterialTheme.typography.bodySmall)
                    Text("Sessão ${entry.sessionId.take(8)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    @Composable private fun SettingsScreen(state: HubUiState) {
        var newServer by rememberSaveable { mutableStateOf(state.identity?.serverUrl ?: "") }
        var switching by remember { mutableStateOf(false) }
        var discloseAccessibility by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        InfoCard("Servidor conectado atualmente", state.identity?.serverUrl ?: "Nenhum")
        OutlinedTextField(newServer, { newServer = it }, label = { Text("Trocar URL do Painel (ex.: Vercel)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(enabled = newServer.isNotBlank() && !switching, onClick = {
            switching = true
            scope.launch {
                runCatching { HubApi.autoPair(newServer, state.identity?.name ?: Build.MODEL, HubRepository.vault.publicIdentity()) }
                    .onSuccess { identity -> HubRepository.paired(identity) }
                    .onFailure { HubRepository.error(it.message ?: "Não foi possível trocar para este servidor") }
                switching = false
            }
        }, modifier = Modifier.fillMaxWidth()) { Text(if (switching) "Conectando…" else "Conectar a este servidor") }
        OutlinedButton(onClick = { discloseAccessibility = true }, modifier = Modifier.fillMaxWidth()) { Text("Configurar acessibilidade manualmente") }
        OutlinedButton(onClick = { if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }, modifier = Modifier.fillMaxWidth(), enabled = Build.VERSION.SDK_INT >= 33) { Text("Permitir notificações de pedidos") }
        TextButton(onClick = {
            SharingService.current?.stopNow("Reconectando aparelho")
            HubRepository.forget()
        }) { Text("Redefinir conexão e buscar painel novamente", color = MaterialTheme.colorScheme.error) }
        if (discloseAccessibility) AlertDialog(onDismissRequest = { discloseAccessibility = false },
            title = { Text("Divulgação de acessibilidade") },
            text = { Text("O serviço opcional recebe comandos de toque, deslize, voltar, início e texto durante uma sessão autorizada.") },
            confirmButton = { TextButton(onClick = { discloseAccessibility = false; startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }) { Text("Abrir configurações Android") } },
            dismissButton = { TextButton(onClick = { discloseAccessibility = false }) { Text("Cancelar") } })
    }
    @Composable private fun InfoCard(title: String, body: String) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    private fun prettyDate(raw: String): String = runCatching {
        val parsed = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(raw)
        if (parsed != null) SimpleDateFormat("dd/MM HH:mm:ss", Locale.getDefault()).format(parsed) else raw
    }.getOrDefault(raw)
}

package com.androidremotehub

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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
                while (true) {
                    val identity = HubRepository.state.value.identity
                    if (identity != null) {
                        try {
                            val api = HubApi(identity)
                            api.json("/device/heartbeat", DeviceTelemetry.heartbeat(this@MainActivity))
                            val requests = api.requests()
                            if (requests.any { it.id !in previous }) HubNotifications.request(this@MainActivity, identity.name)
                            previous = requests.map { it.id }.toSet()
                            HubRepository.update { it.copy(requests = requests, connection = if (it.active == null) "Conectado • aguardando autorização local" else it.connection, error = null) }
                        } catch (e: ApiException) {
                            if ((e.status == 401 || e.status == 403) && HubRepository.state.value.identity?.token == identity.token) {
                                SharingService.current?.stopNow("Credencial revogada ou expirada")
                                HubRepository.forget()
                                HubRepository.error("A credencial expirou ou foi revogada. Faça um novo pareamento.")
                            } else HubRepository.error("Servidor indisponível (${e.status}). Tente novamente.")
                        } catch (_: Exception) {
                            HubRepository.update { it.copy(connection = "Sem conexão com o servidor", error = "Verifique a internet e o endereço do servidor.") }
                        }
                    }
                    delay(4000)
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
                Text(if (state.identity == null) "Seus dispositivos.\nSob seu controle." else "${state.identity!!.name}", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(if (state.identity == null) "Assistência privada com consentimento em cada sessão." else state.connection, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.error?.let { error ->
                Card(Modifier.padding(horizontal = 20.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF422938))) {
                    Text(error, Modifier.padding(16.dp))
                    TextButton(onClick = { HubRepository.error(null) }, modifier = Modifier.padding(start = 8.dp)) { Text("Fechar alerta") }
                }
            }
            TextButton(onClick = { diagnostics = true }) { Text("Privacidade e diagnóstico") }
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
        var server by rememberSaveable { mutableStateOf("") }
        var code by rememberSaveable { mutableStateOf("") }
        var name by rememberSaveable { mutableStateOf(Build.MODEL) }
        var checkedServer by remember { mutableStateOf<String?>(null) }
        var checkedOrigin by remember { mutableStateOf<String?>(null) }
        var busy by remember { mutableStateOf(false) }
        var privacy by rememberSaveable { mutableStateOf(false) }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            InfoCard("Você decide quando compartilhar", "Cada transmissão exige a confirmação nativa do Android. A notificação permite encerrar imediatamente. Não pedimos acesso a SMS, leitura de notificações, câmera, microfone ou armazenamento irrestrito. Feche conteúdo privado antes de compartilhar: o que estiver visível poderá aparecer na transmissão.")
            Row {
                Checkbox(checked = privacy, onCheckedChange = { privacy = it })
                Text("Li as informações de privacidade e sou o proprietário deste aparelho.", Modifier.padding(top = 12.dp))
            }
            OutlinedTextField(server, { server = it; checkedServer = null; checkedOrigin = null }, label = { Text("Servidor HTTPS") }, placeholder = { Text("https://painel.exemplo.com") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedButton(enabled = !busy && privacy && server.isNotBlank(), onClick = {
                busy = true
                scope.launch {
                    runCatching { HubApi.inspectServer(server) }.onSuccess { checkedServer = it; checkedOrigin = HubApi.validateServer(server) }
                        .onFailure { HubRepository.error(it.message ?: "Não foi possível verificar o servidor") }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) { Text("Verificar identidade do servidor") }
            checkedServer?.let { InfoCard("Confirme seu servidor", "$checkedOrigin\n$it\nCompare a origem com o painel do proprietário antes de parear.") }
            OutlinedTextField(code, { code = it.take(32) }, label = { Text("Código do painel") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(name, { name = it.take(80) }, label = { Text("Nome deste Android") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(enabled = privacy && checkedServer != null && code.isNotBlank() && name.isNotBlank() && !busy, onClick = {
                busy = true
                scope.launch {
                    runCatching { HubApi.pair(checkedOrigin!!, code, name, HubRepository.vault.publicIdentity()) }
                        .onSuccess { identity -> HubRepository.paired(identity); com.androidremotehub.notifications.NotificationIntegration.initialize(this@MainActivity) }
                        .onFailure { HubRepository.error(it.message ?: "Pareamento recusado") }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Confirmar servidor e parear") }
            Text("O código expira e funciona uma única vez. O painel deve estar autenticado para criá-lo.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    @Composable private fun SessionScreen(state: HubUiState) {
        val active = state.active
        if (active == null) {
            InfoCard("Disponível com o app aberto", "Mantenha esta tela aberta para receber pedidos. Com Firebase configurado, pedidos também podem chegar por notificação. Nenhuma transmissão começa automaticamente.")
            if (state.requests.isEmpty()) InfoCard("Nenhum pedido pendente", "O proprietário pode solicitar assistência no painel web.")
            state.requests.forEach { request ->
                var allowControl by remember(request.id) { mutableStateOf(false) }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Pedido de assistência", style = MaterialTheme.typography.titleLarge)
                        Text("Operador: ${request.operator}\nSolicitado: ${if (request.requestedControl) "visualização e controle opcional" else "somente visualização"}\nExpira: ${prettyDate(request.expiresAt)}")
                        if (request.requestedControl) {
                            Row {
                                Checkbox(checked = allowControl, enabled = state.accessibilityEnabled, onCheckedChange = { allowControl = it })
                                Text("Autorizo controle nesta sessão. Apenas app, Calculadora e Relógio.", Modifier.padding(top = 12.dp))
                            }
                            if (!state.accessibilityEnabled) Text("Para controle, habilite manualmente o serviço em Ajustes. Você pode compartilhar só a tela.")
                        }
                        Button(onClick = { requestSharing(request, allowControl) }, modifier = Modifier.fillMaxWidth()) { Text("Continuar para consentimento Android") }
                        OutlinedButton(onClick = {
                            lifecycleScope.launch {
                                runCatching { HubApi(state.identity!!).json("/sessions/${request.id}/reject", JSONObject()) }
                                    .onSuccess { HubRepository.record(request.id, "Pedido recusado localmente"); HubRepository.update { it.copy(requests = it.requests.filterNot { r -> r.id == request.id }) } }
                                    .onFailure { HubRepository.error("Não foi possível recusar. A sessão continua sem autorização.") }
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
                    Text("Telas protegidas permanecem bloqueadas. Bloquear o aparelho encerra a sessão.")
                    Button(onClick = { SharingService.current?.stopNow("Encerrada localmente pelo proprietário") }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF7186), contentColor = Color(0xFF160A0F)), modifier = Modifier.fillMaxWidth()) { Text("Encerrar compartilhamento agora") }
                    if (state.controlEnabled) OutlinedButton(onClick = { SharingService.current?.suspendControl() }, modifier = Modifier.fillMaxWidth()) { Text("Suspender controle imediatamente") }
                    else if (active.requestedControl && state.accessibilityEnabled) {
                        Text("O operador solicita controle. Ao autorizar, ele poderá tocar, deslizar e inserir texto no app, Calculadora e Relógio.")
                        OutlinedButton(onClick = { SharingService.current?.approveControl() }, modifier = Modifier.fillMaxWidth()) { Text("Autorizar controle nesta sessão") }
                    }
                }
            }
            var assistanceText by rememberSaveable(active.id) { mutableStateOf("") }
            OutlinedTextField(assistanceText, { assistanceText = it.take(256) }, label = { Text("Campo de teste: texto não sensível") }, modifier = Modifier.fillMaxWidth())
            InfoCard("Arquivos escolhidos por você", "O painel não navega no armazenamento. Todo envio exige um arquivo ou destino escolhido no seletor oficial. Limite de 20 MiB por arquivo; conteúdo trafega no canal WebRTC criptografado.")
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
        InfoCard("Registro local", "Até 100 eventos de autorização e encerramento. Não guardamos imagens, texto digitado ou conteúdo dos arquivos.")
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
        var confirmDisconnect by remember { mutableStateOf(false) }
        var discloseAccessibility by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        InfoCard("Servidor pareado", state.identity!!.serverUrl)
        InfoCard("Controle assistido opcional", "Permite gestos somente durante uma sessão que você aprovou e apenas no Android Remote Hub, Calculadora e Relógio. Não lê texto, senhas ou notificações. Acessibilidade atual: ${if (state.accessibilityEnabled) "habilitada" else "desabilitada"}.")
        OutlinedButton(onClick = { discloseAccessibility = true }, modifier = Modifier.fillMaxWidth()) { Text("Configurar acessibilidade manualmente") }
        OutlinedButton(onClick = { if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }, modifier = Modifier.fillMaxWidth(), enabled = Build.VERSION.SDK_INT >= 33) { Text("Permitir notificações de pedidos") }
        Text("Sem a permissão, o app aberto continua recebendo pedidos. Durante captura o Android também indica a atividade em seus controles de serviços.", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(enabled = state.active == null, onClick = {
            scope.launch {
                runCatching {
                    val old = state.identity!!
                    val rotated = HubApi(old).json("/device/rotate", JSONObject())
                    HubRepository.paired(old.copy(token = rotated.getString("token")))
                }.onSuccess { HubRepository.update { it.copy(connection = "Credencial rotacionada com segurança") } }
                    .onFailure { HubRepository.error("Não foi possível rotacionar. Tente novamente quando estiver conectado.") }
            }
        }, modifier = Modifier.fillMaxWidth()) { Text("Rotacionar credencial deste aparelho") }
        TextButton(onClick = { confirmDisconnect = true }) { Text("Revogar e desconectar este Android", color = MaterialTheme.colorScheme.error) }
        if (discloseAccessibility) AlertDialog(onDismissRequest = { discloseAccessibility = false },
            title = { Text("Divulgação de acessibilidade") },
            text = { Text("O serviço recebe comandos de toque, deslize, voltar, início e texto não sensível. Verifica apenas o pacote ativo e se o foco é uma senha, sem coletar o conteúdo. Só atende app, Calculadora e Relógio, com aparelho desbloqueado e sessão autorizada. Você pode suspender localmente e desativar o serviço nas configurações do Android.") },
            confirmButton = { TextButton(onClick = { discloseAccessibility = false; startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }) { Text("Entendi; abrir configurações Android") } },
            dismissButton = { TextButton(onClick = { discloseAccessibility = false }) { Text("Cancelar") } })
        if (confirmDisconnect) AlertDialog(onDismissRequest = { confirmDisconnect = false }, title = { Text("Desconectar este aparelho?") },
            text = { Text("A sessão será encerrada e a credencial revogada no servidor. Um novo acesso exigirá pareamento e consentimento novamente.") },
            confirmButton = { TextButton(onClick = {
                confirmDisconnect = false
                SharingService.current?.stopNow("Aparelho desconectado localmente")
                scope.launch {
                    runCatching { HubApi(state.identity!!).revoke() }
                        .onSuccess { HubRepository.forget() }
                        .onFailure { HubRepository.error("Revogação não confirmada. Mantenha o app sem compartilhar e revogue pelo painel quando a conexão voltar.") }
                }
            }) { Text("Revogar e desconectar") } }, dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Cancelar") } })
    }
    @Composable private fun InfoCard(title: String, body: String) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    private fun prettyDate(raw: String): String = runCatching { DateTimeFormatter.ofPattern("dd/MM HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(raw)) }.getOrDefault(raw)
}

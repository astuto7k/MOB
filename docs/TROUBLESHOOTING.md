# Diagnóstico

| Sintoma | Verificação |
|---|---|
| API não inicia | DATABASE_URL acessível, migrações, MASTER_KEY com 32 bytes base64 e logs de erro. Não gere uma nova chave para corrigir um banco existente. |
| Login volta à tela inicial | Cookie Secure exige HTTPS em produção; host do painel e WEB_ORIGIN devem coincidir exatamente. Não misture localhost/127.0.0.1. |
| CSRF_REJECTED | Recarregue a sessão; confira Origin, rota `/api` na mesma origem e cabeçalho x-csrf-token. Não remova a proteção. |
| MFA inválido | Relógios com NTP; código de seis dígitos; códigos já usados no mesmo intervalo não são reutilizados. Use recuperação se perdeu o autenticador. |
| Pareamento inválido | Código de 12 caracteres sem espaços, cinco minutos, uso único, servidor correto e máximo cinco aparelhos ativos. |
| Aparelho offline | App aberto, internet/HTTPS válido, bateria e restrições OEM. Standalone não mantém polling oculto quando fechado. |
| Solicitação não chega | Abra o Android. FCM é opcional, depende de configuração real, token e notificações autorizadas. Não inicia captura. |
| Tela sem vídeo | Confira aprovação no Android, diálogo MediaProjection, notificação do serviço, estado ICE e bytes recebidos. FLAG_SECURE/tela bloqueada não devem aparecer. |
| Mesma rede funciona, redes distintas falham | Verifique IPv4 público, TURN_URLS/TURN_SECRET, firewall UDP3478 e range49160–49200; teste relay obrigatório e candidato selecionado. |
| TURN TLS falha | Certificado/hostname/cadeia, permissão de leitura da chave, TURN_TLS_ENABLED=1 e TCP5349. HTTPS do painel não configura Coturn. |
| Sessão encerra ao oscilar rede | Falha segura deliberada. Retorne ao Android e aceite uma nova sessão. Não há retomada de consentimento. |
| Controle não age | Acessibilidade manualmente ativada, consentimento local, estado ACTIVE, concessão válida, tela desbloqueada e app benigno permitido. |
| Coordenadas não coincidem | Veja rotação/letterboxing e captura de app único. Use somente visualização quando o sistema não fornece um mapeamento confiável. |
| Arquivo recusado | Limite configurado até20MiB, nome seguro, SHA-256, canal ativo, confirmação SAF no aparelho e espaço no destino. |
| Build Android falha | JDK21, Gradle wrapper9.3.1, SDK37.0 e build-tools36.0.0, Maven do produtor WebRTC acessível; leia apps/android/RESEARCH.md. |
| Contêiner reinicia | `docker compose logs --tail=100 api web caddy coturn`, sem publicar corpos/cookies/segredos. Verifique limites de RAM/disco. |
| Login bloqueado após restore | Execute recuperação local owner:reset, ative MFA e pareie novamente; credenciais antigas permanecem revogadas. |

Ao pedir ajuda, informe versão, fabricante/Android, estado exibido, instante da falha e erro sem segredos. Não envie senha, código de recuperação, .env, tokens, chave de assinatura, captura privada ou JSON Firebase.

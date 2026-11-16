# Validação do aplicativo Android

> Referência histórica da versão base0.1.0. Este arquivo foi preservado na cópia de evolução para rastreabilidade; seu hash/build não descreve o APK0.2.0. Os resultados desta evolução estão em [NOTAS_EVOLUCAO.md](NOTAS_EVOLUCAO.md).

Data: 16/11/2026. Ambiente macOS, JDK 21, Android SDK 37.0/build-tools 36.0.0, Gradle 9.3.1 e AGP 9.1.1. O ambiente inicialmente não tinha Java/SDK; foram instalados isoladamente no diretório de trabalho. Não havia Android físico conectado nem emulador executando.

## Verificações automatizadas

Build final concluído com sucesso: `assembleStandaloneDebug`, `assembleFirebaseDebug`, `testStandaloneDebugUnitTest`, `lintStandaloneDebug`, `lintFirebaseDebug` e `assembleStandaloneRelease`. A execução final terminou com `BUILD SUCCESSFUL`, incluindo otimização R8 do release. O APK debug final foi verificado com `apksigner`: assinatura v2 válida, pacote `com.androidremotehub`, versão0.1.0, minSDK30 e targetSDK37. SHA-256: `a06c0a9dc0a7e0795198cb283706016254d6b9800408af5f6521dd274a4dac57`. Release gerado sem assinatura externa é explicitamente não assinado.

O teste `AuthorizationGateTest` exercita código Kotlin real usado pelo serviço; o relógio controlado é uma ferramenta de teste unitário, não uma simulação apresentada como transmissão Android.

10 testes de política passaram: ausência de consentimento/estado ativo; visualização sem escalada remota de controle; encerramento/revogação local; sinalização fechada; expiração de lease de 10 s; sessão errada; pacotes fora da lista, bloqueio e foco de senha; replay e limite de comandos; suspensão local; estados terminais. Eles não validam MediaProjection, renderização, comportamento de fabricantes, despacho de gestos ou rede real.

Lint mantém 14 avisos por variante, sem baseline ou desativação de verificações: 7 recomendações de atualização de dependências, 2 recomendações de `apply()` em vez de `commit()`, 4 sugestões de extensões KTX e 1 atributo de acessibilidade ignorado em API 30. O uso síncrono de `commit()` mantém a confirmação de persistência/revogação local antes de anunciar sucesso; as versões fixadas formam o conjunto compilado e estão documentadas em `RESEARCH.md`.

## Matriz que exige dispositivo real

Nenhuma linha desta matriz está validada em hardware nesta entrega.

| Caso | Procedimento | Resultado esperado |
| --- | --- | --- |
| Parear | Código real criado no painel; confirmar domínio no Android | Dispositivo cadastrado e heartbeat real no painel |
| Negar consentimento | Recusar o diálogo nativo | Sem captura; pedido recusado, auditado |
| Visualizar | Aceitar consentimento na tela nativa | Vídeo real somente no navegador autorizado |
| Reutilizar consentimento | Encerrar e solicitar nova sessão | Novo diálogo obrigatório; nenhum token antigo reutilizado |
| Encerrar localmente | Botão e ação da notificação | Recursos liberados, vídeo para e novos comandos recusados |
| Bloquear tela | Botão de bloqueio durante captura | Compartilhamento encerrado; não retoma ao desbloquear |
| Revogar remotamente | Revogar dispositivo/sessão no painel | Socket/evento encerra; token deixa de autorizar requisições |
| Partição de rede | Cortar API/WSS com mídia P2P ainda possível | Gate expira em no máximo 10 s sem confirmação; não promete revogação global instantânea sem comunicação |
| Permissões | Negar notificações; desabilitar acessibilidade durante sessão | Visualização mantém indicadores Android; controle é suspenso; nenhuma reativação automática |
| Controle sem consentimento | Enviar tap/swipe/text fora do estado ACTIVE ou após suspensão | Nenhum novo despacho; validação do gate |
| Controle permitido | Abrir Calculadora/Relógio permitido localmente e autorizar | Tap/swipe/back/home funcionam quando suportados; campo de teste do app aceita texto não sensível |
| Conteúdo sensível | Abrir pacote fora da lista ou foco marcado como senha | Controle recusado; nenhuma leitura de texto; FLAG_SECURE mantido na mídia |
| Rotação API 30–33 | Girar Android 11–13 | DisplayListener redimensiona o display existente e preserva proporção |
| Rotação API 34–37 | Girar Android 14–17 | Callback redimensiona display/superfície, sem segundo createVirtualDisplay |
| Redes | Wi-Fi igual, redes distintas, móvel, TURN obrigatório | ICE válido, relay real quando necessário; quedas exigem nova autorização |
| Enviar arquivo | Painel oferece arquivo; recusar/aceitar destino SAF | Sem gravação antes de autorização local, política e auditoria; bytes/integridade conferidos |
| Baixar arquivo | Selecionar arquivo SAF no Android | Somente o arquivo escolhido chega ao navegador; cancelamento/progresso observáveis |
| Arquivo inválido | Exceder limite, hash errado, blocos extras ou envio antes de file-accept | Rejeição, cache limpo e evento; nenhum documento inválido mantido |
| Limite configurável | Reduzir maxFileBytes no painel | Android consulta política antes de iniciar e aplica o menor limite |
| Push opcional | Configurar Firebase real, app em segundo plano | Notificação visível; abrir autorização; nunca inicia captura automaticamente |
| Processo encerrado | Encerrar processo, reabrir | Sem retomada de sessão; caches de transferência órfãos removidos |

O APK debug é um artefato de desenvolvimento. Assinatura de produção e testes acima são etapas necessárias antes do uso regular. A existência de código e APK compilado não equivale ao aceite dos testes em hardware.

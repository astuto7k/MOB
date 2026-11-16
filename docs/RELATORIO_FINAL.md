# Evolução0.2.0 — análise de referência e alterações próprias

Data: 16/11/2026. Pasta independente: `android-remote-hub-evolucao`. A entrega original foi preservada; seu relatório está arquivado em [RELATORIO_BASE_0_1.md](RELATORIO_BASE_0_1.md). Não se afirma equivalência total ao APK concorrente nem validação física de Android.

## Referência analisada e decisão

O arquivo fornecido contém um instalador/carregador e um APK interno. A análise estática identificou funções legítimas de tela/gestos/arquivos, junto a rotinas de coleta de senha/PIN/padrão, keylogger/notificações, solicitações enganosas de credenciais e interferência na remoção/proteções. Os relatórios da pasta `comparacao-familhao` distinguem código presente, permissões e comportamento não testado. Não instalamos/executamos a amostra nem acessamos seus endpoints.

A evolução contém somente código do próprio Android Remote Hub. Não importa DEX, bibliotecas, assets, marca, certificado, configuração ou servidor do concorrente. As funções invasivas não foram reproduzidas. Visualização, gestos restritos e arquivos escolhidos já estavam implementados na versão base com autorização visível.

## Alterações entregues

- **Central Privacidade e diagnóstico**, disponível antes/depois do pareamento: pacote/versão/build/variante/Android; estados locais de notificações, acessibilidade, rede e sessão; origem pareada e explicações de privacidade.
- **Teste voluntário de HTTPS/saúde e política autenticada:** mostra resultado/erro e horário reais. Não inicia captura/controle, não enumera outros apps e não afirma que HTTPS prova WebSocket/ICE/TURN.
- **Limite de arquivos observado:** apresenta a política consultada em memória ou o teto sujeito à configuração. A operação continua verificando a política antes de transferir; não confia no rótulo da interface como autorização.
- **Identidade mínima do operador:** a API inclui `{id,email}` do operador autorizado nas sessões/pedidos/eventos WS, sem senha, segredo MFA ou token administrativo. O modelo Android já consome esse campo no pedido.
- **Atualização transparente:** a interface explica atualização manual do próprio APK, canal do proprietário e assinatura compatível; não instala outros pacotes nem simula loja/permissão do Android.
- **Recusa segura na API:** ausência inesperada de uma relação necessária à autorização termina a sessão e recusa a continuação. Foi adicionado um teste de regressão.
- Android: versionCode2/versionName0.2.0, pacote `com.androidremotehub`. Manifesto/permissões e `AuthorizationGate.kt` conferidos como idênticos à versão base.

Arquivos principais novos/alterados: Android `PrivacyDiagnostics.kt`, `MainActivity.kt`, `data/Models.kt`, `data/HubRepository.kt`, `files/SelectedFileTransfer.kt` e `app/build.gradle.kts`; API `hub.ts`, `signaling.ts`, `security.ts`, `db.ts`, `config.ts`; teste `authorization-regression.test.ts` e harness `integration-test.mjs`. Não houve mudança de esquema/migração.

## Validação executada nesta cópia

| Verificação | Resultado |
|---|---|
| Build API/shared e tipos dos três workspaces | Aprovados |
| Lint do painel; verificação estática API/shared | Aprovados |
| Testes JS/TS |19 aprovados:7 API,11 painel,1 shared |
| Integração SQL/HTTP/WS em PGlite |23 grupos aprovados, pool serial de teste |
| Integração em PostgreSQL18.7 nativo |23 grupos aprovados, pool5; migração aplicada; servidor temporário somente em127.0.0.1 |
| Build Android standaloneDebug | Aprovado,45s/53tarefas |
| Testes Kotlin/JVM |10 aprovados, zero falhas/erros/skips |
| Lint Android offline |Zero erros e9 avisos; sem baseline/supressão. Avisos de atualização diferem conforme consulta online disponível |
| APK |`apksigner` verificou assinatura v2; `aapt` confirmou versão0.2.0/código2, minSDK30/target37 |
| Permissões e gate |Arquivos idênticos à base; nenhuma permissão nova |
| Integridade do ZIP/artefatos |CRC e SHA-256 fornecidos com a entrega |

SHA-256 do APK: `246f1e4bf689c07320bb84ee3dc8ca306e5cabc0b4550109b7337a291350ea33`. Artefato: `android-remote-hub-evolucao-debug.apk`, aproximadamente81MiB. A assinatura debug é de desenvolvimento; assinatura de distribuição deve ser externa conforme APK_SIGNING.md.

O painel não teve alteração de código: seu build standalone/revisão visual pertencem à validação base; nesta cópia, tipos/lint e seus11 testes foram executados novamente. Firebase/release Android0.2 não foram recompilados; não apresente o release0.1 anterior como um release0.2.

## Falha encontrada durante a evolução

Com pool5 no PGlite, duas execuções retornaram `include.device=null` embora uma consulta independente confirmasse o aparelho existente, causando erro500. O comportamento não ocorreu com pool serial. O harness passou a usar1 conexão somente no PGlite; produção/PostgreSQL nativo preservam padrão5, configurável por `DATABASE_POOL_SIZE` entre1–10. O erro não foi ignorado: além do ajuste do ambiente de teste, a API agora recusa relações ausentes e possui regressão específica. Os23 grupos passaram também no PostgreSQL18.7 nativo com5 conexões, sem esse retorno inconsistente. Isso não é um teste de carga exaustivo.

## Instalação e próximos passos

Use README.md para configurar esta cópia, gere seu .env/proprietário/MFA e atualize a API da evolução junto ao Android para receber a identidade do operador. O esquema do banco permanece o mesmo. Não copie segredos/configuração do APK analisado. O `node_modules` usado localmente apenas para compilar não integra o ZIP; em uma extração nova rode `npm ci`.

Instale o debug somente nos seus aparelhos para ensaio. Pacote e assinatura compatíveis permitem atualização; a confirmação/instalação continua sendo feita pelo Android. Não foi instalado nenhum APK no aparelho nesta tarefa. Execute a matriz física em TESTING.md: consentimento, rotação, bloqueio, gestos, SAF, queda/revogação e duas redes com TURN próprio.

Permanecem pendentes: UI e diagnóstico no Android físico, vídeo/controle/arquivos reais, push Firebase, implantação Docker/HTTPS/TURN na VPS e backup/restore operacional. A central de diagnóstico não substitui esses testes. Conteúdo privado visível pode aparecer numa tela autorizada; não há redação universal automática.

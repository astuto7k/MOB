# Evolução Android Remote Hub 0.2.0

Esta cópia independente preserva o projeto original. `versionCode=2`, `versionName=0.2.0`; pacote continua `com.androidremotehub`, para permitir atualização quando a assinatura também for compatível. Nenhum código, imagem, marca ou mecanismo do APK de referência foi reutilizado.

## Mudanças

- Central **Privacidade e diagnóstico** no cabeçalho, disponível antes e depois do pareamento.
- Identificação local da versão, pacote, tipo de build, variante standalone/Firebase e versão Android. Não apresenta a variante Firebase como prova de entrega de push.
- Estado observado de notificações, acessibilidade, rede e sessão; atualização local manual e ao retornar à tela. Não coleta SSID, localização, lista de aplicativos, mensagens ou conteúdo privado.
- Origem do servidor pareado e botão voluntário para verificar a rota de saúde por HTTPS. Sem pareamento, é possível informar uma origem para esse teste público. Com pareamento, a consulta autenticada de `/device/policy` mostra o limite real de arquivo e a duração configurada.
- Resultado ou erro do diagnóstico permanece na interface, sem tokens/chaves e sem simular aprovação de WebSocket, ICE ou TURN. O teste não inicia MediaProjection, sessão remota, controle ou instalação.
- A política consultada fica apenas na memória. O rótulo de arquivos mostra o último limite consultado quando disponível; caso contrário, informa o teto de 20 MiB sujeito à política. O fluxo continua consultando a política antes de cada transferência, validando seus limites e encerrando a operação se a consulta falhar.
- Explicação de privacidade e atualização manual do próprio APK pelo canal do proprietário, com verificação de pacote/versão/assinatura. Sem disfarce de loja, instalador genérico, VPN ou instalação silenciosa.

## Arquivos alterados

`app/build.gradle.kts`, `MainActivity.kt`, novo `PrivacyDiagnostics.kt`, `data/Models.kt`, `data/HubRepository.kt` e `files/SelectedFileTransfer.kt`. Os caminhos Kotlin ficam em `app/src/main/java/com/androidremotehub/`.

O protocolo de consentimento, o gate de controle, a lista de apps benignos, as permissões do manifesto, o MediaProjection e os canais WebRTC foram preservados. O modelo Android já lê o e-mail do operador quando a API fornece `operator.email`; o backend dessa cópia deve entregar somente o operador autorizado daquela sessão.

## Validação desta evolução

Execução offline com JDK21, Android SDK37.0/build-tools36.0.0, Gradle9.3.1 e cache isolado:

```sh
./gradlew --offline --no-daemon :app:assembleStandaloneDebug :app:testStandaloneDebugUnitTest :app:lintStandaloneDebug
```

Resultado: **BUILD SUCCESSFUL em45s**, 53 tarefas executadas, **10 testes JVM aprovados**, sem erros/falhas/skips. Lint: **0 erros e9 avisos** nessa execução offline; recomendações de atualização de dependências podem diferir da consulta online da versão base. Nenhuma verificação foi desativada e nenhum baseline foi usado para ocultar resultados. Não foi refeito o build Firebase, cuja configuração não mudou.

APK `app/build/outputs/apk/standalone/debug/app-standalone-debug.apk`: assinatura v2 válida segundo `apksigner`; `aapt` confirmou pacote `com.androidremotehub`, versionCode2, versão0.2.0, minSDK30 e targetSDK37. SHA-256: `246f1e4bf689c07320bb84ee3dc8ca306e5cabc0b4550109b7337a291350ea33`.

O manifesto e `AuthorizationGate.kt` continuam idênticos à versão base. O relatório `TEST_REPORT.md` da versão base é histórico; não use seu hash como hash do APK0.2.0.

Sem aparelho físico/emulador conectado, não foram testados layout Android, toque no diagnóstico, rede/HTTPS a partir do aparelho, captura, gestos ou arquivos reais. Um build aprovado não comprova essas operações.

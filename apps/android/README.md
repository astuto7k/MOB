# Aplicativo Android Remote Hub

App nativo Kotlin/Jetpack Compose. Android 11 (API 30) ou superior; `compileSdk` e `targetSdk` 37 (Android 17). O fluxo usa exclusivamente APIs públicas. O compartilhamento de tela mostra conteúdo visível autorizado pelo proprietário; feche dados e notificações privadas antes de consentir. `FLAG_SECURE` é respeitado, mas não existe classificação/redação automática universal de conteúdo de todos os aplicativos. Não pede câmera, microfone, SMS, contatos, notificações privadas ou acesso geral ao armazenamento.

## Compilar

Instale JDK 17+ (JDK 21 usado na verificação), Android command-line tools, plataforma `platforms;android-37.0`, `build-tools;36.0.0` e platform-tools. Defina `JAVA_HOME` e `ANDROID_HOME`, ou configure o SDK no Android Studio.

```sh
sdkmanager 'platforms;android-37.0' 'build-tools;36.0.0' platform-tools
sdkmanager --licenses
./gradlew :app:assembleStandaloneDebug :app:testStandaloneDebugUnitTest :app:lintStandaloneDebug
```

APK: `app/build/outputs/apk/standalone/debug/app-standalone-debug.apk`. É universal, com bibliotecas nativas WebRTC; o tamanho é maior que um APK separado por arquitetura. O Gradle Wrapper tem distribuição e SHA-256 fixados. O primeiro build baixa dependências Google Maven, Maven Central e o repositório oficial Stream.

## Uso

1. Inicie a infraestrutura e autentique o proprietário no painel. Gere um código em **Parear Android**.
2. No aparelho, leia a divulgação de privacidade, digite a origem HTTPS da API/painel, verifique a identidade TLS e compare o domínio com o painel. Depois informe o código e confirme o pareamento.
3. Mantenha o app aberto para receber pedidos no modo standalone. A presença no painel expira se o app ficar fechado sem uma sessão ativa.
4. Solicite uma sessão pelo painel. No Android, aceite somente visualização ou marque controle opcional. O próximo diálogo é o consentimento nativo do sistema.
5. A transmissão começa apenas após esse consentimento e aprovação autenticada da sessão. A notificação visível e o botão local encerram a captura; o bloqueio da tela também encerra.
6. Para arquivos, selecione a origem ou o destino no seletor oficial do aparelho. Limite: o menor entre 20 MiB e a política atual do proprietário, consultada antes de cada transferência; um arquivo por vez; SHA-256 verificado. Sem confirmação da política/auditoria, o app recusa o início. O painel não navega nas pastas. Arquivos selecionados usam cache privado temporário para verificar tamanho/integridade antes do destino; ele é apagado ao concluir, cancelar ou encerrar a sessão. Interrupção abrupta do processo pode deixar cache até a próxima inicialização do app, quando os arquivos temporários próprios são removidos.
7. Para desconectar, use **Ajustes → Revogar e desconectar**. Se não houver internet, revogue também pelo painel ao recuperar a conexão. Não se anuncia revogação confirmada sem resposta do servidor.

Desenvolvimento: APK debug aceita HTTP somente em `10.0.2.2`, `localhost` e `127.0.0.1`. Use a porta da API exposta no ambiente local. Release exige HTTPS. O app usa a validação TLS padrão do Android e nunca instala um trust manager permissivo. A impressão do certificado mostrada no pareamento serve para conferência da identidade; não é uma promessa de atestado remoto de hardware.

## Controle assistido: escopo deliberado

Acessibilidade deve ser habilitada manualmente em Ajustes após a divulgação. A sessão e a permissão de controle são independentes da visualização. O serviço só atende o próprio app, Calculadora Android/Google e Relógio Android/Google (`AuthorizationGate.SAFE_PACKAGES`). Abra localmente o app permitido antes de controlá-lo. Outros pacotes, incluindo bancos, navegadores, lojas, autenticação, configurações e launcher, são recusados. Não há execução de comandos, pesquisa de campos ou leitura de texto da interface.

A verificação consulta somente o nome do pacote e a marca de senha do foco. Texto é aceito apenas em foco editável não marcado como senha; um campo de teste no app permite validar texto não sensível. Gestos já entregues ao sistema podem concluir sua duração (até 1,5 s); encerrar ou revogar bloqueia novos despachos, sem promessa de desfazer um gesto anterior. A interface do Android e restrições adicionais do fabricante podem bloquear interações. Android 13+ pode exigir que o proprietário habilite manualmente configurações restritas para aplicativos instalados fora da loja, pela tela oficial de informações do app; o programa não altera essa proteção.

O gate exige estado `ACTIVE`, aprovação local, confirmação do backend com validade monotônica de no máximo 10 s, WebSocket aberto, tela desbloqueada, pacote permitido, sequência crescente e limite de eventos. Suspender controle bloqueia localmente antes da chamada de revogação. Falha de rede/sinalização encerra; não existe retomada automática de captura após uma sessão terminada.

## Firebase opcional

A variante `standalone` não carrega Firebase. A variante `firebase` usa configuração explícita, sem `google-services.json` e sem chave privada no APK. As seguintes propriedades públicas identificam seu projeto Firebase:

```sh
./gradlew :app:assembleFirebaseDebug \
  -PFIREBASE_APPLICATION_ID='1:SEU_NUMERO:android:SEU_ID' \
  -PFIREBASE_API_KEY='SUA_CHAVE_PUBLICA_DO_APP' \
  -PFIREBASE_PROJECT_ID='SEU_PROJETO' \
  -PFIREBASE_SENDER_ID='SEU_NUMERO'
```

Registre o pacote `com.androidremotehub` no Firebase. Restrinja a chave pública por aplicação e APIs no console. O backend precisa de credencial de serviço externa e `FCM_SERVICE_ACCOUNT_FILE`; veja documentação da infraestrutura. O APK não contém essa credencial de serviço. Sem propriedades, a variante Firebase compila mas não inicializa o serviço; continua com polling em primeiro plano. Push apenas mostra notificação e abre a autorização, sem iniciar MediaProjection. A entrega de push não foi validada sem um projeto e aparelho reais.

## Assinar release

Crie a chave fora do repositório, guarde backup criptografado e carregue senhas no ambiente (evite argumentos que apareçam no histórico). Configure:

- `ARH_KEYSTORE_PATH`: caminho absoluto externo da keystore.
- `ARH_KEYSTORE_PASSWORD`.
- `ARH_KEY_ALIAS`.
- `ARH_KEY_PASSWORD`.

```sh
./gradlew :app:assembleStandaloneRelease
```

Sem essas variáveis, o build release produz um APK **não assinado** e não instalável diretamente. Com as variáveis, usa exclusivamente a configuração externa. A chave debug de desenvolvimento não é uma identidade de produção.

## Segurança de credenciais e captura

O bearer individual é cifrado com AES-GCM usando chave não exportável do Android Keystore. A chave EC pública é registrada durante o pareamento; esta versão autentica por bearer e não implementa atestado de hardware nem prova de posse EC no backend. A segurança de hardware efetiva depende do aparelho. Backups e transferência do app são desabilitados; reinstalação exige novo pareamento. A rotação invalida a credencial anterior no backend e só está disponível fora de sessão ativa.

`ConsentScreenCapturer` cria um único MediaProjection/VirtualDisplay por autorização. Mudanças de tamanho redimensionam o display existente. Android 14+ usa `onCapturedContentResize`; Android 11–13 usam `DisplayListener`. `onStop()` libera captura, superfície e recursos WebRTC. O serviço é `START_NOT_STICKY`, não inicia pelo boot e nunca restaura um token. `FLAG_SECURE` e o bloqueio do Android são respeitados.

## Validação

Veja `TEST_REPORT.md`: build e testes de política não comprovam transmissão ou gestos num aparelho. A matriz física inclui consentimento negado/revogado, orientação, bloqueio, fabricante, redes distintas, TURN, troca de rede e arquivos com provedores SAF reais.

# Pesquisa Android e decisões

Consultado em 16/11/2026. As versões fixadas foram resolvidas pelo Gradle e verificadas por build; não se depende apenas de uma recomendação textual.

| Tema | Fonte primária | Decisão |
| --- | --- | --- |
| SDK atual | [Android 17 SDK](https://developer.android.com/about/versions/17/setup-sdk) | API 37, plataforma SDK `37.0`; mínimo API 30. |
| Compatibilidade | [AGP 9.1.1](https://developer.android.com/build/releases/agp-9-1-0-release-notes) | AGP 9.1.1 + Gradle 9.3.1 e JDK 17+; par compatível com API 37, Kotlin embutido 2.2.10. |
| MediaProjection | [Guia oficial](https://developer.android.com/media/grow/media-projection) | Consentimento por sessão, um display por token; resize em vez de recriação. |
| Encerramento | [Callback oficial](https://developer.android.com/reference/android/media/projection/MediaProjection.Callback) | `onStop` é terminal; recursos liberados e nova autorização obrigatória. |
| Foreground service | [Tipos oficiais](https://developer.android.com/develop/background-work/services/fgs/service-types) | Tipo `mediaProjection`, permissão própria e notificação; início por Activity, sem boot. |
| Controle | [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService) | Apenas `dispatchGesture`, ações globais e `ACTION_SET_TEXT` de foco não sensível; divulgação e ativação local. |
| Credenciais | [Android Keystore](https://developer.android.com/privacy-and-security/keystore) | AES-GCM e chave EC não exportável; sem alegar hardware/atestado universal. |
| RTC nativo | [Releases do produtor](https://github.com/GetStream/stream-video-android-webrtc/releases) | WebRTC 156.0.5 estável de novembro, artefato padrão `org.webrtc` no repositório Stream. Não usar `org.webrtc:google-webrtc` antigo/abandonado nem SDK comercial de acesso remoto. |
| Compose | [Compiler/BOM](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler) | Plugin Compose 2.2.10 alinhado ao Kotlin; BOM 2026.03.00 fixado para compatibilidade verificada. BOM 2026.09.00 disponível, atualização futura requer matriz de regressão. |
| Push | [FCM Android](https://firebase.google.com/docs/cloud-messaging/android/get-started), [releases](https://firebase.google.com/support/release-notes/android) | BOM 35.2.0, variante opcional sem Firebase obrigatório ou credencial de serviço no APK. |

Activity 1.12.4, Lifecycle 2.9.4, Core 1.17.0 e Coroutines 1.10.2 são versões estáveis fixadas no conjunto compilado. Lint informa versões mais recentes; a seleção não significa que sejam as últimas. Atualizar em conjunto com compilador, AGP e testes físicos. OkHttp 5.5.1 resolvido em Maven Central para HTTPS/WSS sem customizar confiança TLS. Não há bibliotecas de acesso remoto de terceiros.

Controle de qualquer aplicativo de terceiros foi descartado: APIs de acessibilidade não oferecem uma classificação infalível de operações financeiras/sensíveis. A lista curta de pacotes benignos limita o MVP a interações que podem ser explicadas e autorizadas localmente. A visualização continua sujeita às proteções do Android e aos aplicativos do aparelho.

A variante Firebase fixa adicionalmente Fragment 1.9.1 ([release oficial](https://developer.android.com/jetpack/androidx/releases/fragment)): Google Play services transitivamente resolvia Fragment 1.1.0, incompatível com a API moderna de Activity Result. A correção aumenta a versão transitiva em vez de suprimir o erro do lint.

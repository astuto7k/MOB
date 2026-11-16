# APK e assinatura externa

Requisitos: JDK21, Android SDK `platforms;android-37.0`, `build-tools;36.0.0`, acesso ao Google Maven/Maven Central e repositório oficial do produtor WebRTC. O wrapper Gradle9.3.1 está no projeto, com checksum. O build usa AGP9.1.1 e minSDK30. Versões e fontes: apps/android/RESEARCH.md.

```bash
cd apps/android
./gradlew assembleStandaloneDebug testStandaloneDebugUnitTest lintStandaloneDebug
./gradlew assembleFirebaseDebug
```

Standalone não precisa de Firebase. Firebase compila sem segredos de serviço no APK; os IDs públicos de projeto e a configuração real são necessários para notificações. Consulte apps/android/README.md. Nenhuma chave privada de serviço Firebase pertence ao Android.

Para release, crie uma chave em armazenamento externo ao repositório:

```bash
keytool -genkeypair -keystore /caminho-seguro/arh-release.jks -alias arh -keyalg RSA -keysize 4096 -validity 10000
```

Não inclua senha na linha de comando, no Gradle, no Git ou no pacote de entrega. Configure ARH_KEYSTORE_PATH com caminho absoluto, ARH_KEY_ALIAS, ARH_KEYSTORE_PASSWORD e ARH_KEY_PASSWORD no ambiente da sessão de build ou em secrets do CI. O keytool pergunta os valores de criação. Guarde a chave e as senhas offline: perder a chave impede atualizar instalações com a assinatura antiga.

```bash
./gradlew assembleStandaloneRelease
# Após assinatura externa configurada:
apksigner verify --verbose --print-certs app/build/outputs/apk/standalone/release/app-standalone-release.apk
```

Sem as variáveis, release pode produzir `app-standalone-release-unsigned.apk`; não o apresente como instalável assinado. A compilação release valida R8/empacotamento, mas não valida distribuição. Debug usa chave de desenvolvimento gerada pelo Android tooling e é explicitamente destinado aos aparelhos de teste do proprietário.

Antes de instalar, compare SHA-256 com SHA256SUMS entregue. `adb install -r caminho.apk` só atualiza uma instalação com assinatura compatível; se houver outra assinatura, planeje remoção/novo pareamento. A desinstalação apaga o Keystore local e a identidade anterior deve ser revogada no painel.

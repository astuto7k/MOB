# Acesso ao painel

O login pede apenas a senha do proprietário. E-mail não é necessário. A senha fica salva no banco e não é redefinida ao reiniciar ou publicar o projeto.

# Testes na Vercel

Para publicar e usar o APK com o endereço gratuito da Vercel, siga [docs/VERCEL.md](docs/VERCEL.md). A versão 0.5.1 exige banco PostgreSQL e pareamento por código; não há senha padrão nem cadastro automático de aparelhos.

# Android Remote Hub — MOB 0.5.1

Cópia independente criada após análise estática do APK fornecido. Inclui central de privacidade/diagnóstico, política real e identidade mínima do operador. Não incorpora código/assets do concorrente nem coleta de credenciais/interferência em proteções. Consulte [o relatório desta evolução](docs/RELATORIO_FINAL.md).

Assistência remota privada e consentida para Androids do mesmo proprietário. Monorepositório com painel Next.js, API NestJS, PostgreSQL/Prisma, aplicativo Kotlin/Compose, WebRTC e infraestrutura opcional Caddy/Coturn. O limite atual é de 100 aparelhos cadastrados ativos.

**Estado desta entrega:** código implementado, builds e testes descritos em [RELATORIO_FINAL.md](docs/RELATORIO_FINAL.md). Os testes de API e a compilação do APK não validam captura, gestos ou TURN em um Android físico. Faça os ensaios de [TESTING.md](docs/TESTING.md) antes de considerar os critérios de uso inicial atendidos.

O Android sempre decide se aceita o pedido, confirma a captura pelo diálogo do sistema e pode encerrá-la localmente. Controle é separado, opcional e restrito a aplicativos benignos enumerados no código. Não há root, shell remoto, captura em boot, gravação de tela no servidor ou acesso irrestrito ao armazenamento. Uma tela integral autorizada pode mostrar conteúdo privado visível: feche esse conteúdo antes de compartilhar; não existe filtro universal automático.

## Estrutura

```text
apps/web/            Painel e viewer WebRTC
apps/api/            API, identidade, sessões, sinalização, migrações e testes
apps/android/        Aplicativo nativo e Gradle wrapper
packages/shared/    Estados, limites e contratos compartilhados
infrastructure/     Docker, HTTPS, TURN, backup, restore e scripts
docs/               Arquitetura, segurança, manual e relatórios
.github/workflows/   CI de web, API, banco e Android
```

## Desenvolvimento local

Requisitos: Node **24.15+ na linha24**, npm11+, Docker Engine/Compose ou PostgreSQL18, JDK21 e Android SDK37.0/build-tools36.0.0 para compilar Android. A versão Node usada nesta entrega foi24.16.0. Android Studio é opcional; Gradle wrapper está incluído e verifica checksum da distribuição. Dependências npm são fixadas em package-lock.json; use `npm ci`.

```bash
npm ci
npm run setup:env
docker compose -f docker-compose.dev.yml up -d
npm run db:generate
npm run db:migrate
npm run db:bootstrap
```

O bootstrap pede e-mail e senha oculta (mínimo 8 caracteres) e só funciona antes da criação do primeiro proprietário. Não há usuário/senha padrão. Segredos .env são gerados localmente, não exibidos nem incluídos no pacote de código. Se .env já existe, setup se recusa a sobrescrevê-lo. A API lê o .env da raiz, inclusive nos comandos de workspace.

Abra dois terminais na raiz:

```bash
# Terminal1
npm run dev:api
# Terminal2
npm run dev:web
```

Painel: `http://localhost:3000`. API de desenvolvimento: `http://localhost:3001/api/v1`. O wrapper dev:web carrega o .env da raiz, incluindo NEXT_PUBLIC_WS_URL, para WebSocket direto na porta3001. Produção usa WSS na mesma origem via Caddy. Não misture localhost com127.0.0.1 no navegador, pois Origin/cookie são verificados.

**Alternativa sem Docker, somente desenvolvimento:** numa instalação nova use `npm run setup:env -- --pglite` no lugar do setup acima; rode `npm run db:local` em um terminal e prossiga com generate/migrate/bootstrap. O PostgreSQL WASM/PGlite fica em `.local-db`, acessível apenas por127.0.0.1:54329. Não use esse servidor de testes na VPS; ele não fornece TLS nem o modelo de concorrência do PostgreSQL nativo.

## Android e primeiro pareamento

```bash
cd apps/android
./gradlew assembleStandaloneDebug testStandaloneDebugUnitTest lintStandaloneDebug
```

APK gerado: `apps/android/app/build/outputs/apk/standalone/debug/app-standalone-debug.apk`. Instale no seu aparelho por ADB ou instalação manual consentida. O APK debug entregue é identificável, usa assinatura de desenvolvimento e serve a testes pessoais; produza uma assinatura própria para distribuição durável.

1. Entre no painel e ative MFA em Configurações. Guarde os códigos de recuperação offline.
2. Abra o Android Remote Hub, leia a divulgação de privacidade e informe seu servidor HTTPS.
3. No painel, Adicionar dispositivo → Gerar código. Digite o código no app e confirme servidor/nome.
4. Com o app aberto, solicite assistência no painel. Aceite ou recuse no Android.
5. Aceite o diálogo MediaProjection do sistema. O navegador negocia o vídeo após essa aprovação.
6. Para controle, habilite Acessibilidade manualmente e conceda controle para essa sessão. Encerrar no aparelho, na notificação ou no painel finaliza a sessão.

Android11/API30 é a versão mínima do app; o target/compileSDK é37. Depende de verificação física por versão/OEM. Para desenvolvimento com USB, use debug + `adb reverse tcp:3001 tcp:3001` e servidor `http://127.0.0.1:3001` no aparelho. Emulador pode usar `http://10.0.2.2:3001`. Cleartext é permitido só nesses hosts de depuração; release exige HTTPS. Internet real/rede distinta precisa dos domínios/TURN próprios descritos em [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Variáveis e produção

[.env.example](.env.example) descreve as variáveis. DATABASE_URL, MASTER_KEY e senha do PostgreSQL são necessárias. MASTER_KEY tem32 bytes em base64 e cifra segredos MFA/push; faça cópia offline antes de guardar dados. TURN_SECRET é compartilhado apenas entre API e Coturn; TURN_URLS/STUN_URLS apontam à sua infraestrutura. Nenhuma credencial TURN estática vai para o APK. Políticas de sessão/arquivo/retenção ficam no painel; rede/segredos ficam no ambiente.

Para VPS, siga [DEPLOYMENT.md](docs/DEPLOYMENT.md): DNS, HTTPS, portas, TURN/TLS, migrações, provisionamento, backups age, restauração segura, atualizações e FCM. O deploy não foi feito numa VPS nesta entrega. Os domínios de exemplo não são domínios existentes.

## Firebase e assinatura

A variante standalone funciona sem conta Firebase com o app em primeiro plano. A variante Firebase usa FCM opcional para avisos visíveis; não autoriza ou inicia captura. Configuração pública Android e serviço backend externos estão em [apps/android/README.md](apps/android/README.md) e [DEPLOYMENT.md](docs/DEPLOYMENT.md).

Release usa as variáveis ARH_KEYSTORE_PATH, ARH_KEYSTORE_PASSWORD, ARH_KEY_ALIAS, ARH_KEY_PASSWORD. A chave fica fora do Git. Instruções de criação, assinatura e verificação: [APK_SIGNING.md](docs/APK_SIGNING.md). Compilação sem esses valores pode gerar APK release não assinado, que não é um APK instalável de distribuição.

## Validação e documentação

```bash
npm run db:generate
npm run build -w @arh/shared
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
npm run check:infra
```

Integração cria seu próprio banco PGlite efêmero, aplica SQL das migrações e executa clientes HTTP/WebSocket reais contra uma API separada. Para PostgreSQL nativo dedicado a testes, forneça ARH_TEST_DATABASE_URL; CI já prepara um banco descartável. Os clientes de teste não são aparelhos Android e não transmitem mídia.

Consulte o [índice dos documentos](docs/README.md), [manual de uso](docs/MANUAL_PT_BR.md), [limitações](docs/LIMITATIONS.md), [segurança](docs/SECURITY.md) e [relatório de validação](docs/RELATORIO_FINAL.md). Nenhum resultado de teste físico ou implantação deve ser inferido apenas da presença de código.

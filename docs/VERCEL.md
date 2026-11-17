# MOB para testes: GitHub + Vercel + Neon

O repositório continua em https://github.com/astuto7k/MOB. O painel é um aplicativo Next.js com rotas de servidor: GitHub Pages, que serve arquivos estáticos, não executa esta aplicação completa.

## Endereços verificados na conta

- Painel: https://web-iota-gold-96.vercel.app
- API: https://api-nu-five-29.vercel.app
- Neon: banco `neon-charcoal-flower`, plano Free, conectado ao projeto `api`.

Esses endereços pertencem aos projetos existentes. Um build Ready não prova que o banco ou a comunicação Android funcionam; confira `/api/v1/health` pelo endereço do painel após o deploy.

## Configuração

Há dois projetos Vercel ligados ao mesmo repositório e branch `main`:

| Projeto | Root Directory | Framework | Node |
| --- | --- | --- | --- |
| web | `apps/web` | Next.js | 24.x |
| api | `apps/api` | NestJS | 24.x |

Permita acesso aos arquivos fora do Root Directory nas configurações do monorepo. Os arquivos `apps/*/vercel.json` definem a instalação a partir da raiz. O build da API aplica as migrações Prisma, compila e inicializa opcionalmente o primeiro proprietário. Os dois projetos precisam incluir os workspaces da raiz na instalação.

No projeto **web**, ambiente Production:

```dotenv
API_INTERNAL_URL=https://api-nu-five-29.vercel.app
NEXT_PUBLIC_API_URL=/api/v1
```

No projeto **api**, ambiente Production:

```dotenv
NODE_ENV=production
DATABASE_URL=<fornecida pela integração Neon; manter privada>
DATABASE_POOL_SIZE=1
MASTER_KEY=<32 bytes aleatórios em base64; manter privada e estável>
WEB_ORIGIN=https://web-iota-gold-96.vercel.app
```

Não use `localhost`, IP da sua rede doméstica, URLs de preview ou uma lista de domínios presumidos no APK. O navegador e o Android usam a origem pública do **painel**. O painel encaminha `/api/v1/*` à API e preserva cookies seguros, CSRF e credenciais do aparelho. Redirecionamentos da API são recusados para proteger essas credenciais. A URL Production da API deve aceitar as chamadas da aplicação sem a tela de login da Vercel; a autenticação do MOB continua obrigatória nas rotas protegidas.

Para o primeiro usuário, escolha **uma** opção:

1. Execute `npm run db:bootstrap` com as variáveis do banco e da API no ambiente local confiável; informe e-mail e senha no terminal.
2. Configure `BOOTSTRAP_OWNER_EMAIL` e `BOOTSTRAP_OWNER_HASH` (hash Argon2id de uma senha aleatória, nunca a senha em texto) na Vercel antes do primeiro build. O inicializador usa transação e trava de banco, cria o proprietário somente se não houver nenhum usuário e nunca altera senha ou MFA de contas existentes.

Não existe senha padrão. A senha inicial do ambiente configurado fica somente no arquivo privado de acesso entregue localmente; não a adicione ao GitHub. Após entrar, troque a senha e ative o MFA nas configurações do painel.

Configure previews com banco separado e `WEB_ORIGIN` exata de cada ambiente. A configuração Production não autoriza automaticamente origens de preview. Não use banco Production para executar testes de integração.

## Android 0.5.1

APK de teste para Android 11 ou superior, ARM64 e ARMv7. Não foi validado em aparelho físico nesta entrega. Se a instalação acusar conflito de assinatura com o APK anterior, desinstale a versão anterior e instale esta; será necessário parear novamente. O APK desta entrega é uma compilação release assinada, com depuração desabilitada. Ele ainda não foi distribuído pela Play Store nem submetido a uma aprovação do Google.

1. No celular, abra o endereço do painel e use **Baixar APK de teste**.
2. Entre no painel e clique em conectar Android para gerar o código.
3. No app, informe `https://web-iota-gold-96.vercel.app`, confira o servidor, digite o código e confirme.
4. Mantenha o app aberto para receber pedidos. Ao solicitar assistência no painel, aceite o pedido e a autorização de captura do próprio Android.
5. Revogue o aparelho no painel para testar o encerramento. O app não recria credenciais revogadas nem troca de servidor sozinho.

## Comunicação e limites

Sinalização WebRTC usa HTTPS com consultas curtas, cursor incremental e mensagens temporárias no PostgreSQL. Assim, as duas pontas podem atingir instâncias Vercel diferentes sem depender de memória ou arquivos `/tmp`. A API consulta a autorização no banco; os clientes interrompem a sessão se a autorização deixa de ser renovada. Instâncias Vercel novas não encerram sessões de outras instâncias nem redefinem senhas.

Vídeo, comandos assistidos e arquivos escolhidos pelo proprietário viajam pelo WebRTC; não são enviados como uploads para as funções da Vercel. O controle é opcional, exige aprovação local e mantém a lista restrita de aplicativos permitidos deste projeto.

O STUN padrão permite testar conexões diretas, mas não garante passagem por todas as redes móveis, CGNAT ou firewalls. Para essas redes, configure um TURN acessível pela internet em `TURN_URLS` e `TURN_SECRET`, com credenciais temporárias compatíveis com o endpoint de ICE. A integração atual usa o formato de credencial HMAC do Coturn. A Vercel não hospeda o servidor Coturn deste projeto. Sem um TURN real validado, o vídeo entre redes diferentes permanece uma limitação conhecida.

Consultas frequentes consomem cotas de Functions e banco. Para testes curtos, acompanhe o uso nos painéis; não há garantia de operação ilimitada no plano gratuito. Não é necessário comprar domínio para estes testes.

## Diagnóstico e validação

- `/api/v1/health` no painel: deve retornar `service: mob-api`, `storage: postgresql` e `signaling: https-polling`, após consultar o banco.
- Sem autenticação, `/api/v1/devices` deve retornar 401.
- `DEPLOYMENT_NOT_CONFIGURED`/503: configurar `API_INTERNAL_URL` em web e fazer redeploy.
- `API_UNAVAILABLE`/502: conferir logs da API, migrações, variáveis e conexão Neon.
- `API_REDIRECT_REJECTED`/502: conferir URL da API e proteção do deploy.
- Código recusado: gerar outro código; é de uso único, expira e não é substituído por pareamento automático.
- Vídeo não conecta em 4G/5G: verificar ICE/TURN real; HTTP saudável não prova passagem de mídia.

Verificações locais: typecheck, lint, testes web/API/contratos, builds web/API e 25 verificações de integração com banco descartável, incluindo negociação HTTPS entre duas instâncias. Android: build, testes unitários e lint. Esses testes não representam captura de tela, toque ou transferência executados num Android físico.

Referências oficiais: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [NestJS na Vercel](https://vercel.com/docs/frameworks/backend/nestjs), [estado persistente e WebSockets](https://vercel.com/docs/functions/websockets), [Neon na Vercel](https://neon.tech/docs/guides/vercel-native-integration).


## Google Play Protect e reprodução do APK

Mantenha o Google Play Protect ativo. A versão publicada usa as APIs de captura consentida do Android, HTTPS e controle opcional com divulgação e autorização local. Não altera o Play Protect. A assinatura release verifica a origem e a integridade do APK, mas não representa uma aprovação automática do Google. A instalação e a classificação precisam ser verificadas no Android real com o Play Protect ativo.

O APK 0.5.1 requer Android 11+ e ARM64/ARMv7. Se houver conflito com a assinatura de uma compilação anterior, desinstale a versão anterior e faça novo pareamento após instalar. As atualizações seguintes devem usar a mesma chave release.

Para reproduzir o binário, configure o SDK Android e JDK 21, mantenha o arquivo privado de assinatura fora do Git e execute:

```sh
node infrastructure/scripts/build-android-release.mjs --signing-file /caminho/privado/signing.json
```

O JSON privado contém `ARH_KEYSTORE_PATH`, `ARH_KEYSTORE_PASSWORD`, `ARH_KEY_ALIAS` e `ARH_KEY_PASSWORD`. Faça backup da chave e do JSON; eles não pertencem ao repositório público. O script compila, testa, verifica assinatura e depuração, copia o mesmo APK para a raiz e para o download do painel e atualiza `docs/APK-SHA256SUMS`. O GitHub Actions verifica o APK publicado.

Referências: [assinatura Android](https://developer.android.com/studio/publish/app-signing) e [Google Play Protect](https://developers.google.com/android/play-protect).

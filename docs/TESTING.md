# Testes e evidências

Esta entrega distingue testes de política, testes de integração de servidor, revisão visual e ensaios físicos. Os resultados efetivamente executados estão em RELATORIO_FINAL.md. Um cliente HTTP que usa a credencial de um fixture não representa um Android e não comprova MediaProjection/WebRTC.

## Automatizados

```bash
npm ci
npm run db:generate
npm run build -w @arh/shared
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
npm run check:infra
cd apps/android
./gradlew assembleStandaloneDebug testStandaloneDebugUnitTest lintStandaloneDebug
./gradlew assembleFirebaseDebug
```

API: sete testes de TOTP/cifra/CSRF/TURN/estados/validação e compartilhado: um teste do contrato. Painel: onze testes de estados, autorização, limite de arquivo e geometria de gestos (não são testes de browser automatizado). Argon2id é exercitado pelos logins da integração HTTP. Android: dez testes JVM da barreira de autorização e política de aplicativos/gestos. Não há testes instrumentados físicos executados.

Integração: `infrastructure/scripts/integration-test.mjs` inicia uma API compilada e PostgreSQL WASM/PGlite temporário, aplica o SQL versionado e verifica **23 grupos** com requisições HTTP/WebSocket reais: login/cookie, CSRF/origem, pareamento descartável/expirado/revogado, recurso de outro proprietário, limite de cinco, concorrência lógica de sessão, papel do aprovador, TURN HMAC/TTL, contrato de sinalização, negação após término, revogação em atividade, política reduzida de arquivos, metadados inválidos, TOTP/replay/recuperação, bearer expirado, logout e rate limiting. Para expiração, os testes alteram timestamps dos próprios fixtures; isso não é simulado como passagem do tempo físico.

Com PostgreSQL nativo dedicado, defina ARH_TEST_DATABASE_URL. O script aplica migrações e cria contas de teste nesse banco; use somente banco descartável. CI prepara PostgreSQL18 e executa essa modalidade. PGlite multiplexa conexões e não substitui validação de lock/concorrência no banco nativo. A CI criada só pode ser marcada como executada depois de um run no GitHub.

## Revisão no navegador

Uma conta temporária sem aparelhos reais foi usada no painel local integrado: login, dashboard vazio, código gerado pela API e tela de políticas/MFA/acessos. Layout foi observado em largura móvel e desktop1440px; o registro visual acompanha a entrega. Nenhuma lista de aparelhos ou estatística foi preenchida artificialmente para a imagem. Testes de pareamento Android, viewer com vídeo, gestos e SAF não são cobertos por essa revisão.

## Matriz física obrigatória — inicialmente pendente

Use aparelhos próprios com Android14/15/16/17 e, se precisar suportar, Android11–13. Registre modelo/OEM, versão do app/OS, rede, data, resultado e evidência sem conteúdo privado. Não preencha "passou" apenas por compilar.

| Ensaio | Resultado esperado |
|---|---|
| Negar notificações e captura | App explica limitação; nenhuma mídia/controle inicia. |
| Parear e reutilizar código | Primeiro confirma no aparelho; repetição falha. |
| Pedir e recusar sessão | Pedido visível no Android; recusa terminal no painel. |
| Aceitar visualização | Diálogo nativo por sessão, notificação, vídeo real e métricas de bytes/frames. |
| Bloquear tela | Captura e controle param; não há contorno de bloqueio. |
| Abrir tela FLAG_SECURE | Conteúdo protegido não aparece; não é substituído por captura alternativa. |
| Girar e alterar resolução | Vídeo acompanha; coordenadas só agem quando mapeamento válido. |
| Habilitar/desabilitar Acessibilidade | Sem controle até habilitação manual e consentimento por sessão; revogação impede gestos. |
| Toque, gesto, voltar, início, texto | Só nos apps benignos permitidos e enquanto sessão/control ativo. |
| Campo senha/app não permitido | Ação rejeitada, sem leitura/log do conteúdo. |
| Suspensão e término local | Canal/captura encerram, novos eventos não agem. Cronometre o atraso de revogação. |
| Revogar aparelho com sessão ativa | Servidor invalida credenciais; Android fecha imediatamente ao receber estado e no máximo até expirar a concessão em rede interrompida. |
| Fechar navegador/perder WS | Android fecha a sessão; reabrir exige aprovação nova. |
| Encerrar app/matar processo/reiniciar API | Recursos liberados ou OS finaliza; sessão não recupera consentimento antigo. |
| Wi-Fi → rede móvel / internet lenta | Erro/encerramento transparente; não apresenta conectado sem mídia. |
| Mesma rede, redes distintas, TURN obrigatório | Confirme candidato host/srflx/relay selecionado e bytes de vídeo; TURN obrigatório deve usar relay próprio. |
| SAF envio/recebimento/cancelamento | Seleção local, limite menor aplicado, SHA-256 igual, cancelamento e falhas visíveis. |
| Firebase configurado e ausente | Aviso abre autorização; nunca inicia captura por push. Standalone aberto continua funcional. |
| Restore isolado | Dump decifra, migrações aplicam, acessos antigos falham, owner reset/MFA/pareamento novos funcionam. |
| TLS expirado ou domínio errado | Android/navegador recusam; não há trust-all. |

Critério de aceite operacional: executar o fluxo proprietário→pareamento→aprovação→vídeo→controle permitido→término→revogação, em duas redes diferentes com relay, e registrar resultados. Implantação/backup também precisam de ensaio numa VPS Linux; análise YAML não prova execução Docker.

## Resultado adicional da evolução0.2

Os23 grupos também passaram em PostgreSQL18.7 nativo local, com pool5, após aplicar a migração versionada. Para PGlite, o harness configura DATABASE_POOL_SIZE=1: seu multiplexador pode devolver relações inconsistentes sob consultas concorrentes. PostgreSQL nativo mantém padrão5 (configurável1–10). Um teste de regressão confirma recusa segura se uma relação de autorização necessária estiver ausente. Isso não substitui ensaio de mídia/controle no Android nem teste de carga.

# API HTTP

Base: `/api/v1`. JSON UTF-8. API e painel ficam sob a mesma origem em produção, com Caddy roteando `/api/*` para a API. A origem adicional `api.seudominio` atende o Android. Os exemplos `*.exemplo.com` são placeholders.

## Autenticação e autorização

O proprietário entra por e-mail/senha e, quando habilitado, TOTP. A resposta cria um cookie de sessão opaco, HttpOnly, SameSite=Strict e Secure em produção (`__Host-arh_admin`, sem Domain, Path=/). Desenvolvimento usa `arh_admin`. O servidor armazena SHA-256 do token aleatório. Duração absoluta padrão: oito horas, configurável entre uma e 24.

`GET /auth/me` e login retornam `csrfToken`. Toda mutação autenticada por cookie exige `X-CSRF-Token` e `Origin` exatamente igual a `WEB_ORIGIN`; CORS permite somente essa origem. O token anti-CSRF fica em memória no painel, não em localStorage. Login e recuperação rejeitam Origin divergente. Android usa `Authorization: Bearer <credencial-individual>`, nunca token em URL. Credenciais do Android expiram em 30 dias por padrão, com máximo de 90, e são armazenadas apenas como hash no servidor.

Não há cadastro público nem envio de reset por e-mail. O primeiro proprietário é provisionado localmente por `npm run bootstrap`. Códigos de recuperação são criados ao habilitar MFA, exibidos uma vez e consumidos individualmente. Recuperar a conta altera a senha, desativa o MFA anterior e revoga todos os acessos administrativos e sessões remotas; habilite novamente o MFA.

A sessão remota pertence a um aparelho, proprietário e acesso administrativo específico. Outra sessão administrativa pode consultar o histórico, mas não sinalizar, controlar ou encerrar a sessão pertencente ao acesso original. Revogar um aparelho ou uma sessão administrativa encerra suas sessões remotas.

Na evolução0.2, respostas de sessão REST/WS e pedidos do aparelho incluem `operator: {id,email}` do operador associado, sem campos de senha/MFA/tokens. Isso permite identificar o solicitante no Android. O acesso continua limitado ao proprietário/aparelho daquela sessão. Ausência inesperada da relação necessária à autorização encerra o acesso e retorna `AUTHORIZATION_UNAVAILABLE`, sem continuar sinalização. `DATABASE_POOL_SIZE` aceita1–10, padrão5; o harness PGlite usa1 por limitação do multiplexador de testes, mantendo o pool padrão no PostgreSQL nativo.

## Respostas e erros

Listas são arrays JSON diretos, sem envelope ou paginação nesta versão; dispositivos no máximo 100 ativos, sessões até 100 mais recentes, auditoria até 200 e transferências até 100. POST bem-sucedido retorna **201** por padrão do NestJS, inclusive logout, aprovação e encerramento. GET/PATCH/DELETE retornam **200**. Não presumir 200 em todos os POSTs; clientes aceitam qualquer 2xx.

Erros usam `{ "code": "CODIGO", "message": "Mensagem" }`; erros de validação podem incluir `fields: [{path,message}]`. Campos extras são rejeitados. Exemplos: `INVALID_INPUT`/400, `INVALID_JSON`/400, `PAYLOAD_TOO_LARGE`/413, `INVALID_CREDENTIALS`/401, `MFA_REQUIRED`/401, `UNAUTHORIZED`/401, `CSRF_REJECTED`/403, `NOT_FOUND`/404, `DEVICE_LIMIT`/409, `SESSION_EXISTS`/409, `INVALID_SESSION_STATE`/409, `RATE_LIMITED`/429. Recursos de outro proprietário retornam 404. Corpo HTTP limitado a 192 KiB; arquivos não passam por HTTP.

Limites de uma instância: 240 requisições gerais/minuto/IP; login, recuperação e confirmação de pareamento compartilham 20 tentativas/15 minutos/IP; conta bloqueada por 15 minutos após cinco falhas. `Retry-After` informa espera no limite por IP. Falhas TOTP também contam para bloqueio. TOTP possui seis dígitos, passo de 30 segundos, tolerância de um passo e recusa reutilização do mesmo passo. Sincronize relógios por NTP. O código recém-usado ao habilitar MFA não pode ser usado novamente no login.

## Endpoints

Legenda: **P** público; **A** proprietário por cookie e CSRF nas mutações; **D** aparelho por bearer; **A/D** ambos, dentro do recurso autorizado.

| Método/caminho | Papel | Entrada e resposta |
|---|---|---|
| POST `/auth/login` | P | `{email,password,totp?}` → `{user:{id,email,mfaEnabled},csrfToken}` e cookie. Ausência de TOTP em conta com MFA retorna `MFA_REQUIRED`. |
| POST `/auth/recovery` | P | `{email,recoveryCode,newPassword}` → `{ok:true}`; senha de 12 a 128 caracteres. |
| GET `/auth/me` | A | `{user,csrfToken}`. |
| POST `/auth/logout` | A | `{}` → `{ok:true}`; revoga acesso atual e encerra sessões remotas associadas. |
| GET `/auth/admin-sessions` | A | `[{id,createdAt,expiresAt,userAgent,current}]`, somente acessos vigentes. |
| POST `/auth/admin-sessions/:id/revoke` | A | `{}` → `{ok:true}`. |
| POST `/auth/password` | A | `{currentPassword,newPassword}` → `{ok:true}`; revoga outros acessos administrativos. |
| POST `/auth/mfa/setup` | A | `{}` → `{secret,otpauthUrl}`; segredo pendente, ainda não habilitado. |
| POST `/auth/mfa/enable` | A | `{code}` → `{recoveryCodes:[...]}`; guarde offline. |
| POST `/auth/mfa/disable` | A | `{code}` → `{ok:true}`; exige código ainda não utilizado. |
| GET `/users/me` | A | `{id,email,mfaEnabled,createdAt}`. |
| GET `/devices` | A | `[Device]`, incluindo revogados para histórico. |
| GET `/devices/:id` | A | `Device`. |
| PATCH `/devices/:id` | A | `{name}` de um a 80 caracteres → `Device`. |
| DELETE `/devices/:id` | A | `{ok:true}`; revogação lógica, sem apagar histórico. |
| POST `/pairing` | A | `{}` → `{id,code,expiresAt}`; código aleatório de 12 caracteres, cinco minutos. |
| POST `/pairing/confirm` | P | `{code,name,manufacturer,model,androidVersion,appVersion,publicKey?}` → `{device,token,expiresAt}`. Consome código uma vez e aplica limite de cinco em transação. |
| POST `/pairing/revoke` | A | `{id}` → `{ok:true}`; somente código pendente. |
| POST `/device/heartbeat` | D | `{battery?,charging?,network?,permissions?}` → `{deviceId,serverTime,leaseSeconds:10}`. |
| GET `/device/requests` | D | `[RemoteSession]` não terminais do próprio aparelho. |
| GET `/device/policy` | D | `{maxFileBytes,maxSessionMinutes}` da política do proprietário. Consultar antes de aceitar/preparar transferência; falha de consulta deve impedir o envio. |
| POST `/device/revoke` | D | `{}` → `{ok:true}`; autorrevogação, inclusive sessões. |
| POST `/device/rotate` | D | `{}` → `{token,expiresAt}`; invalida credenciais anteriores. Faça sem sessão ativa e persista a resposta no Keystore. Se a resposta for perdida, refaça o pareamento. |
| POST `/device/push-token` | D | `{token}` → `{ok:true,pushConfigured}`. FCM opcional; token cifrado no banco. |
| POST `/sessions` | A | `{deviceId,requestedControl:false}` → `RemoteSession`; recusa concorrência no mesmo aparelho. |
| GET `/sessions` | A | `[RemoteSession]`. |
| GET `/sessions/:id` | A/D | `RemoteSession`; contato autenticado do aparelho renova seu `lastSeenAt`. |
| POST `/sessions/:id/approve` | D | `{control:boolean}` → `RemoteSession`. Enviar somente após consentimento nativo; controle verdadeiro exige que tenha sido solicitado e aceito localmente. |
| POST `/sessions/:id/reject` | D | `{}` → `RemoteSession`; apenas solicitação pendente. |
| POST `/sessions/:id/active` | D | `{}` → `RemoteSession`; após WebRTC conectado. |
| POST `/sessions/:id/end` | A/D | `{}` → `RemoteSession` terminal; idempotente. |
| POST `/sessions/:id/control/request` | A | `{}` → `RemoteSession`; somente ACTIVE. Não concede controle. |
| POST `/sessions/:id/control/approve` | D | `{}` → `RemoteSession`; somente ACTIVE e pedido de controle existente. Exige ação explícita local. |
| POST `/sessions/:id/control/revoke` | D | `{}` → `RemoteSession`; suspensão local deve bloquear primeiro, antes da chamada HTTP. |
| GET `/sessions/:id/ice` | A/D | `{iceServers:[{urls:[...],username?,credential?}],expiresAt}`; somente sessão aprovada/conectando/ativa. TURN vale no máximo dez minutos ou prazo restante da sessão. |
| GET `/audit` | A | `[{id,type,createdAt,actorId?,ownerId,deviceId?,sessionId?,details}]`. |
| POST `/files` | A/D | `{sessionId,direction,name,size,sha256,status}` → metadados da transferência. Apenas ACTIVE. Não recebe conteúdo. |
| GET `/files` | A | Metadados das últimas 100 transferências. |
| GET `/settings` | A | `{maxSessionMinutes,retentionDays,maxFileBytes}`. |
| PATCH `/settings` | A | Chaves opcionais do objeto anterior. Sessão 1–120 minutos; retenção 7–365 dias; arquivo 1 KiB–20 MiB. Alterações valem para novas autorizações; não estendem sessão ativa. |
| GET `/health` | P | `{status:"ok",time}` após `SELECT 1`; falha de banco retorna 500. |

`Device`: `{id,name,manufacturer,model,androidVersion,appVersion,battery,charging,network,permissions,lastSeenAt,createdAt,revokedAt,online}`. Bateria inteira 0–100 ou null. `network` aceita wifi/cellular/ethernet/offline/unknown, também em maiúsculas. `online` indica comunicação nos últimos 30 segundos e ausência de revogação; não é prova de disponibilidade imediata para captura.

`RemoteSession`: `{id,deviceId,operatorId,status,requestedControl,controlApproved,createdAt,expiresAt,startedAt,endedAt,endReason,device,leaseSeconds:10}`. Timestamps ISO 8601 UTC. Campo `device` contém `Device`. Solicitação aguarda aprovação até dois minutos; duração aprovada padrão 30 minutos. Aprovação reinicia a duração configurada. A API nunca considera permissão permanente de MediaProjection como consentimento de uma nova sessão.

Transferências: `direction` é `TO_DEVICE` ou `FROM_DEVICE`; `status` é `REQUESTED`, `COMPLETED`, `CANCELED` ou `FAILED`. Nome sem barras, caracteres de controle ou caminho, até 255 caracteres; `size` até 20 MiB e limite configurado; `sha256` hexadecimal de 64 dígitos. Eventos são **reportados pelos clientes**, não prova de conteúdo validado pelo servidor. A integridade é verificada diretamente pelos pares. Registros de REQUESTED e COMPLETED podem ser entradas distintas.

Padrões de políticas: 30 minutos por sessão, 90 dias de retenção, 20 MiB por arquivo. Execute `npm run cleanup` por agendamento operacional para efetivar retenção.

## Estados

Fluxo normal: `REQUESTED` (estado de modelo) → `WAITING_DEVICE` ou `WAITING_APPROVAL` → `APPROVED` → `CONNECTING` → `ACTIVE` → `ENDING`/`ENDED`. A criação grava diretamente o estado de espera aplicável; heartbeat move WAITING_DEVICE para WAITING_APPROVAL; aprovação só vem do aparelho; CONNECTING ocorre quando ambos os papéis ingressam na sinalização; ACTIVE é confirmado pelo aparelho ao conectar WebRTC. Encerramentos de segurança são atômicos e podem ir diretamente a ENDED, EXPIRED ou FAILED sem expor ENDING intermediário.

Recusa pendente → REJECTED. Prazo de aprovação/duração → EXPIRED. Estados terminais (`ENDED`, `REJECTED`, `EXPIRED`, `FAILED`) nunca retornam a estados autorizados. Revogação, logout, perda de WebSocket e reinício de servidor encerram sessões. Cada nova sessão exige novo consentimento. A API revisa expiração a cada segundo e autenticação dos sockets a cada cinco segundos; o Android mantém prazo local monotônico de dez segundos. Em partição de rede a revogação depende desse prazo, não de entrega instantânea de eventos.

Consulte [PROTOCOL.md](PROTOCOL.md) para sinalização e DataChannels.


Sinalização HTTPS: POST `/sessions/:id/signal` recebe o mesmo contrato join/offer/answer/ice do WebSocket; GET aceita `?after=SEQ` e retorna `{messages,peerPresent,session}`. Ambas as rotas exigem autenticação, sessão aprovada e vínculo ao operador/aparelho correto; POST administrativo também exige CSRF. O armazenamento é PostgreSQL e compartilhado entre instâncias. Ver [VERCEL.md](VERCEL.md).

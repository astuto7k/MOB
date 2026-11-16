# Protocolo de sessão v1

Implementações: `packages/shared/src/index.ts`, `apps/api/src/signaling.ts`, `apps/web/src/hooks/use-remote.ts`, `apps/android/.../rtc/RtcSession.kt` e `.../files/SelectedFileTransfer.kt`. O protocolo coordena uma sessão autenticada, um navegador operador e um Android. Não suporta múltiplos observadores nem retomada de sessão encerrada.

## Consentimento e transporte

1. Navegador autenticado cria sessão por REST.
2. Android aberto consulta pedidos ou recebe aviso FCM opcional. O proprietário escolhe aceitar/recusar e controle opcional.
3. Android apresenta o diálogo oficial MediaProjection. Recusa envia `/reject`. Aceite inicia um serviço de primeiro plano visível.
4. Android envia `/approve`, prepara MediaProjection e WebRTC e ingressa na sinalização. Consentimento, projeção e VirtualDisplay são usados uma única vez.
5. Ambos os pares ingressam; navegador oferece vídeo `recvonly` e cria DataChannels. Android responde com a faixa de tela.
6. Ao conectar WebRTC, Android confirma `/active`. Controle/arquivos só operam em ACTIVE e enquanto a autorização local estiver vigente.
7. Qualquer encerramento fecha captura, sockets, canais, arquivos temporários e estado de controle. Nova conexão exige novo pedido e consentimento.

O compartilhamento de tela integral aprovado pode mostrar conteúdo privado que estiver visível no aparelho. Não há redação automática de mensagens ou dados; FLAG_SECURE e as proteções do Android são respeitadas, mas não substituem a escolha consciente do que exibir. Evite abrir conteúdo sensível durante a assistência.

O servidor transmite somente sinalização transitória. Vídeo usa SRTP e DataChannels usam DTLS/SCTP. TURN encaminha pacotes cifrados, sem armazenar vídeo. Não há gravação de tela. Quando a conexão direta falha, ICE utiliza o TURN próprio configurado por variáveis de ambiente.

## WebSocket

URL: `wss://painel.seudominio/api/v1/signaling` (navegador) ou origem API configurada no Android. Desenvolvimento local pode usar ws somente nos hosts locais permitidos. Cookie administrativo enviado pelo navegador; `Authorization: Bearer ...` no Upgrade pelo Android. Token em query string não é suportado. Cookies exigem Origin igual a WEB_ORIGIN. Todos os eventos validam autorização e expiração.

Uma conexão por papel por sessão; máximo de 16 sockets por processo; JSON textual; limite de payload 192 KiB e 200 mensagens por dez segundos/socket. Ping/pong e revisão de credenciais a cada cinco segundos. A perda de qualquer socket encerra a sessão. Não reenviar negociação antiga.

Cliente ingressa:

```json
{"type":"join","sessionId":"UUID"}
```

Servidor confirma e avisa quando ambos estão presentes:

```json
{"type":"joined","sessionId":"UUID","peerPresent":false}
{"type":"peer-joined","sessionId":"UUID"}
{"type":"peer-ready","sessionId":"UUID"}
```

`peer-joined` é aviso de compatibilidade ao par já presente. `peer-ready` é emitido aos dois. Navegador deve criar **uma** oferta quando receber peer-ready ou joined com peerPresent=true. Não oferecer antes de existir contraparte. Android só responde a ofertas.

```json
{"type":"offer","sessionId":"UUID","payload":{"type":"offer","sdp":"..."}}
{"type":"answer","sessionId":"UUID","payload":{"type":"answer","sdp":"..."}}
{"type":"ice","sessionId":"UUID","payload":{"candidate":"candidate:...","sdpMid":"0","sdpMLineIndex":0}}
```

SDP no máximo 128 KiB. ICE candidate no máximo 4 KiB; sdpMLineIndex entre zero e 32, campos sdpMid/usernameFragment opcionais. Tipo interno da descrição deve corresponder ao evento. Somente operador envia offer; somente aparelho envia answer. Os clientes enfileiram ICE até a descrição remota estar instalada. O servidor não persiste SDP nem ICE.

Mudança de autorização:

```json
{"type":"session","sessionId":"UUID","payload":{"id":"UUID","status":"ENDED","controlApproved":false}}
```

O payload real é o RemoteSession completo de [API.md](API.md). Estado terminal fecha os sockets. Erro de protocolo envia `{type:"error",code:"SIGNAL_REJECTED",message:"..."}` e fecha com código 1008. Encerramento normal usa 1000; desligamento do servidor usa 1001. Não depender apenas do texto do motivo.

## Controle assistido

Canal confiável/ordenado, label `control`. Mensagens JSON até 4 KiB. Coordenadas normalizadas 0–1 na área real do vídeo, excluindo letterboxing no navegador. `seq` cresce estritamente durante a sessão, impedindo replay; Android limita a 40 ações/segundo.

```json
{"type":"tap","x":0.5,"y":0.4,"seq":1}
{"type":"swipe","x":0.5,"y":0.8,"toX":0.5,"toY":0.2,"durationMs":300,"seq":2}
{"type":"back","seq":3}
{"type":"home","seq":4}
{"type":"text","text":"Texto não sensível","seq":5}
```

Duração de swipe 100–1500 ms. Texto até 256 caracteres, sem controles/quebras de linha, exclusivamente para campo editável não protegido. Android não consulta nem transmite conteúdo de campos. Resposta: `{type:"control-result",seq:5,ok:true}`; `ok:false` indica recusa e não deve ser tratado como execução bem-sucedida.

Android valida independentemente sessão ACTIVE, aprovação de controle no servidor e no estado local, WebSocket conectado, lease menor que dez segundos, tela desbloqueada, foco sem senha e pacote permitido. A versão inicial limita interação a Android Remote Hub, calculadora e relógio AOSP/Google. Settings, navegadores, bancos, autenticadores e demais apps ficam bloqueados. Home/back continuam sujeitos ao contexto permitido. O proprietário habilita Accessibility manualmente e pode suspender controle localmente; um comando remoto não reabilita esse estado.

Qualidade do vídeo é uma operação de visualização, sem conceder controle:

```json
{"type":"quality","profile":"low","seq":6}
```

Perfis `low` e `balanced`: teto de aresta 854/1280 pixels, 15 fps e bitrate aproximado 0,5/1,5 Mbit/s quando o encoder suporta. Aspecto da tela é preservado. Métricas reais vêm de `getStats`; não assumir fps, latência nem rota TURN sem leitura real.

## Arquivos selecionados

Canal confiável/ordenado separado, label `files`; apenas um arquivo em andamento. Blocos binários até 16 KiB, buffer de envio alvo até 256 KiB. Teto comum 20 MiB; a política do servidor pode ser menor. O Android consulta GET `/device/policy` autenticado antes de aceitar ou preparar uma transferência e aplica o menor valor entre maxFileBytes e 20 MiB; falha de consulta deve recusar a transferência. O painel aplica GET `/settings` do proprietário. Arquivos vazios são recusados pelo Android nesta versão. Nome é metadado, nunca caminho remoto.

Download (Android → navegador): operador envia `{type:"file-pick"}`; Android mostra pedido visível e proprietário abre ACTION_OPEN_DOCUMENT. Android copia somente o arquivo escolhido para cache privado, calcula tamanho/SHA-256 e oferece:

```json
{"type":"file-offer","id":"UUID","name":"exemplo.pdf","size":1234,"sha256":"64-digitos-hex","direction":"download"}
```

Navegador valida limites e envia `{type:"file-accept",id:"UUID"}`. Android envia blocos binários, depois `{type:"file-complete",id:"UUID"}`. Navegador confere tamanho e SHA-256 antes de criar link Blob local e envia `{type:"file-result",id:"UUID",ok:true}`. O link não é URL pública nem objeto no servidor.

Upload (navegador → Android): navegador oferece com `direction:"upload"`; Android mostra nome/tamanho e proprietário escolhe destino por ACTION_CREATE_DOCUMENT. Somente depois desse aceite Android envia file-accept. Navegador envia blocos e file-complete. Android verifica integridade no cache privado antes de copiar ao destino autorizado; retorna file-result com ok verdadeiro/falso. Arquivo temporário e documento parcial criado para transferência são removidos em falha/cancelamento quando o provedor SAF permite. Não existe listagem irrestrita de armazenamento.

Cancelamento nos dois sentidos: `{type:"file-cancel",id:"UUID"}`. `file-result` negativo pode incluir `error` apenas para diagnóstico. Queda de sessão, expiração ou suspensão da autorização cancela transferência; cada bloco é verificado no Android. Não reinterpretar texto como comando do sistema.

Os pares reportam metadados via POST `/files`, mapeando upload→TO_DEVICE e download→FROM_DEVICE. O servidor registra resultado reportado, sem receber dados binários. Conferência SHA-256 e entrega precisam ser testadas em aparelho físico. A autorização do servidor tem lease local de dez segundos: sem conectividade não se promete revogação instantânea.

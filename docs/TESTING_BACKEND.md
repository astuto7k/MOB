# Verificação da API e contratos

## Comandos reproduzíveis

Na raiz do monorepositório, com Node 24 e dependências do lockfile:

```sh
npm ci
npm run db:generate
npm run build -w @arh/api
npm run test -w @arh/api
npm run build -w @arh/shared
npm run test -w @arh/shared
npm run typecheck -w @arh/api
```

O gerador oficial Prisma pode precisar baixar seu schema-engine. A geração do cliente não requer banco ativo; o runtime exige DATABASE_URL e MASTER_KEY válidos. `.env` na raiz é carregado pela API e configuração Prisma. Scripts usam `node --import tsx`, evitando sockets IPC desnecessários da CLI tsx em ambientes restritos.

## Testes unitários executados

`apps/api/test/security.test.ts`: **seis testes passaram**.

- Vetor RFC 6238 SHA-1/TOTP, tolerância e rejeição de replay.
- Cifragem AES-256-GCM: recuperação com chave correta, recusa de chave errada e ciphertext alterado.
- Token anti-CSRF vinculado à sessão e credencial HMAC de TURN, com valor de referência conferido independentemente por Python/hmac.
- Estados terminais recusam retorno à autorização; aprovação exige sequência permitida.
- Controle exige ACTIVE, aprovação explícita, prazo válido e ausência de revogação.
- Sinalização recusa campos extras, comandos arbitrários, SDP acima do limite e código de pareamento malformado.

`packages/shared/test/contracts.test.mjs`: **um teste passou**, cobrindo coordenadas inválidas, comandos desconhecidos, texto com controle e teto de arquivo.

Build TypeScript da API e shared executado com sucesso. Os testes acima são unitários reais do código; não comprovam vídeo, gesto físico ou conectividade entre redes.

## Integração HTTP/SQL/WebSocket

O script da raiz `infrastructure/scripts/integration-test.mjs` provisiona PostgreSQL embarcado PGlite com socket TCP, aplica a migração SQL entregue, provisiona dono de teste e inicia a API compilada. Ele valida serviços reais, sem substituir acesso a banco por mocks. PGlite não substitui teste operacional com o container PostgreSQL 18 nem valida características de produção, concorrência/disco da VPS ou backup. Consulte o relatório final e a saída efetiva do script para o resultado: esta página não presume que todo cenário descrito foi executado.

Verificações que precisam constar da saída de integração: senha inválida, login/MFA, CSRF, pareamento descartável/expiração/limite, escopo de dispositivo e acesso administrativo, transições, recusa de controle antecipado, mensagens WS inválidas, encerramento/revogação, credencial expirada, TURN temporário e auditoria. Se o script falhar, o processo deve retornar código diferente de zero; não publicar uma passagem parcial como suite aprovada.

## Validação necessária fora dos testes de API

- Docker: `docker compose config --quiet`, build e inicialização com health checks; PostgreSQL real, migrações, backup criptografado, restore e invalidação de credenciais antigas.
- Android físico: negar/aceitar MediaProjection, revogar durante captura, bloquear tela, girar, usar aviso local de encerramento, perder internet, trocar Wi-Fi por dados e verificar nova autorização obrigatória.
- Controle: habilitar Accessibility manualmente, negar pedido, aprovar sessão, testar calculadora/relógio, bloquear Settings/bancos/campos de senha, suspender localmente e tentar eventos após encerramento.
- Arquivos: seleção SAF em ambos os sentidos, destino explícito, hash SHA-256, cancelamento e limite configurado; nenhum documento parcial deve ser reportado como concluído.
- WebRTC: receber vídeo real Android→navegador em mesma rede, redes diferentes, rede móvel, TURN obrigatório, alta latência e perda de sinalização. Medir rota via getStats; configurar `iceTransportPolicy:"relay"` num teste controlado para comprovar TURN, sem alterar a política de produção inadvertidamente.
- FCM: variante firebase e service account externa, app em segundo plano, notificação visível, ausência de captura automática e comportamento com POST_NOTIFICATIONS negado.

Não houve Android físico, tráfego de mídia WebRTC, relay TURN real, implantação VPS nem teste de restauração executado pelo agente da API. O relatório geral pode registrar validações adicionais efetuadas por outros componentes, com sua evidência específica.

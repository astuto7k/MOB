# Painel web

Next.js App Router, React, TypeScript, Tailwind CSS e componentes locais no padrão shadcn/ui (Button com CVA/Slot e Dialog acessível com Radix). O tema escuro é o padrão; a preferência de tema claro é a única informação persistida em `localStorage`.

O painel consome a API real. Não há dispositivos de exemplo, credenciais padrão, vídeo simulado ou resultados de conexão inventados.

## Desenvolvimento

Na raiz do monorepositório, após configurar o banco, a API e o proprietário conforme o README principal:

```sh
npm ci
npm run dev --workspace @arh/web
```

O frontend usa `http://localhost:3000`. O Next encaminha `/api/v1` para `API_INTERNAL_URL`, cujo padrão é `http://127.0.0.1:3001`. Para o WebSocket de desenvolvimento, defina `NEXT_PUBLIC_WS_URL=ws://localhost:3001/api/v1/signaling` antes de iniciar o Next; o Caddy trata esse encaminhamento na implantação. O navegador deve usar `localhost` ou HTTPS para WebRTC e Web Crypto.

Em produção, prefira a mesma origem HTTPS para painel e `/api/v1`, com Caddy encaminhando HTTP e WebSocket. Não é necessário expor a API diretamente ao navegador em um segundo domínio. `NEXT_PUBLIC_API_URL` é opcional; qualquer variável `NEXT_PUBLIC_*` é pública e nunca deve receber um segredo. Variáveis públicas são incorporadas no build.

## Páginas e operação

- `/login`: login com senha, TOTP quando ativado e recuperação com código de uso único.
- `/`: indicadores derivados da API, aparelhos e atividade recente.
- `/dispositivos`: busca, filtro, pareamento por código de uso único e detalhes com renomeação/revogação.
- `/sessoes`: histórico e solicitação de assistência.
- `/sessoes/:id`: vídeo WebRTC real, controle autorizado, métricas de transporte e arquivos selecionados.
- `/arquivos`: sessões elegíveis e metadados de transferência.
- `/historico`: eventos da auditoria, sem conteúdo de tela ou texto.
- `/configuracoes`: senha, MFA, códigos de recuperação, sessões administrativas e políticas.

O vídeo só é negociado depois da aprovação no Android e da presença dos dois pares no canal autenticado. A página não solicita câmera ou microfone. Ela cria um transceiver de vídeo `recvonly`. O Android é responsável por `MediaProjection`, pela notificação visível e por interromper as ações em telas sensíveis.

O controle exige sessão `ACTIVE`, permissão `controlApproved`, transporte conectado e confirmação recente da API. Uma perda de sinalização interrompe o transporte. Cinco segundos sem uma consulta bem-sucedida da sessão também fecham a conexão no painel. Uma sessão encerrada requer novo pedido; o painel não tenta reconectar automaticamente.

Os gestos usam coordenadas normalizadas sobre a área de vídeo real, ignorando as barras de letterbox. A rotação usa as dimensões recebidas do stream. A entrada de texto é explícita, limitada a 256 caracteres; não há captura do teclado do operador.

## Arquivos

Canal WebRTC confiável `files`, uma transferência por vez, blocos de 16 KiB, limite máximo de 20 MiB (ou limite menor configurado no servidor) e SHA-256. O proprietário escolhe origem/destino no seletor Android. O painel oferece o download somente após verificar o tamanho e o hash. Os dados do arquivo não são enviados à API; somente os metadados/resultados são auditados. O navegador mantém temporariamente até um arquivo na memória. Downloads verificados são liberados ao sair da sessão.

## Verificações

```sh
npm run typecheck --workspace @arh/web
npm run lint --workspace @arh/web
npm run test --workspace @arh/web
npm run build --workspace @arh/web
```

Os testes unitários cobrem CSRF/cookies/MFA/erros da API, validação de arquivos, integridade SHA-256 e coordenadas de vídeo com rotação/letterbox. Não substituem a validação em aparelho físico, redes distintas ou TURN. Consulte o relatório de testes do projeto para os comandos efetivamente executados nesta entrega.

# Pesquisa: API e protocolos

Data da pesquisa: 16/11/2026. Versões efetivamente resolvidas no registry e congeladas no `package-lock.json` da raiz. A versão `latest` do Prisma apontava para um release candidate da linha 8; foi recusada em favor de Prisma 7.10.1 estável. NestJS 12.5.0, Node 24 e TypeScript 6.0.3. Dependências de rede devem ser revisadas a cada atualização (`npm audit`).

Fontes primárias consultadas:

- [NestJS: autenticação](https://docs.nestjs.com/security/authentication) e [compatibilidade de versões](https://docs.nestjs.com/faq/versions): guardas por recurso e suporte ao runtime Node. A aplicação usa sessões opacas revogáveis, evitando depender de JWTs que continuam válidos após revogação.
- [Prisma 7: connection pools](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool): adaptador `@prisma/adapter-pg`, pool limitado a cinco conexões. Credenciais vêm do ambiente. O gerador convencional `prisma-client-js` é mantido nesta versão para integração CommonJS com Nest; migração futura ao gerador `prisma-client` será uma atualização separada e testada.
- [Prisma release status](https://www.prisma.io/docs/orm/release-status): a linha 6 termina sua janela de correções de segurança em 19/11/2026, portanto foi descartada para este projeto novo.
- [OWASP: gerenciamento de sessão](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): cookie HttpOnly, Secure em produção, SameSite Strict, duração absoluta e revogação no servidor. O nome de produção tem prefixo `__Host-`, `Path=/` e não define Domain.
- [OWASP: CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): mutações com cookie exigem Origin exata e token anti-CSRF derivado da sessão, enviado em cabeçalho. A sinalização por cookie também valida Origin.
- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238): TOTP de seis dígitos com passo de 30 segundos, tolerância de um passo e proteção contra reutilização. Segredo cifrado com AES-256-GCM; códigos de recuperação aleatórios são mostrados uma vez e apenas seus SHA-256 são persistidos.
- [Coturn TURN REST](https://github.com/coturn/coturn/blob/master/README.turnserver): username `expiry:sessionId` e senha HMAC-SHA1 em Base64; duração máxima de dez minutos ou prazo restante da sessão. Nenhum segredo TURN é enviado ao APK.
- [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/auth-server) e [envio de mensagens](https://firebase.google.com/docs/cloud-messaging/send/v1-api): token OAuth de curta duração criado com service account externa; o push somente avisa para abrir o aplicativo. Não concede captura ou controle.

## Decisões verificáveis no código

- PostgreSQL com transações e bloqueio da linha do proprietário no consumo de pareamento evita reaproveitamento concorrente e mais de cinco dispositivos ativos.
- Nenhuma mídia, SDP, candidato ICE, texto digitado ou conteúdo de arquivo é gravado nos registros. Sinalização é transitória. Transferências registram metadados e resultado reportado pelos clientes.
- Uma sessão remota pertence ao aparelho, proprietário e à sessão administrativa que a solicitou. Outra sessão administrativa do mesmo proprietário pode visualizar histórico, mas não sinalizar/controlar a sessão já autorizada.
- Perda de WebSocket encerra a sessão. Reinício da API encerra todas as sessões abertas. O Android implementa prazo local de autorização de dez segundos. A revogação em rede particionada é limitada por esse prazo; não se afirma revogação instantânea sem conectividade.
- Rate limiting é local ao processo, apropriado para a implantação de uma instância. Várias réplicas requerem armazenamento compartilhado de limites e fan-out de sinalização; não escalar horizontalmente sem essa mudança.
- A chave pública Android é registrada como metadado de identidade; o protocolo de autenticação desta versão é bearer aleatório, TLS obrigatório, hash no servidor e cifragem Keystore no Android. Não há atestado de hardware nem prova de posse da chave ECDSA no backend.

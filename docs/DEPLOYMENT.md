# Implantação e operação

Use uma VPS Linux (Ubuntu Server 24.04 LTS atualizado, por exemplo), IPv4 público, 2 vCPU, 4 GB RAM e 40 GB disco. Isso é uma referência inicial para 1–5 aparelhos, não uma garantia de banda/capacidade. Instale Docker Engine com Compose plugin seguindo [a documentação oficial](https://docs.docker.com/engine/install/ubuntu/), Node 24 LTS/npm para scripts e age para backups. Acesso ao grupo docker equivale a controle administrativo da máquina.

## Domínio e HTTPS

Copie o projeto para `/opt/android-remote-hub`. Execute `npm ci` e `npm run setup:env` uma única vez. Os exemplos `painel.exemplo.com`, `api.exemplo.com`, `turn.exemplo.com` são placeholders: substitua por domínios seus e crie registros A para a VPS. Não use proxy HTTP de CDN no hostname TURN. Para manter uma única origem, o painel usa sua própria rota `/api/v1`; Android pode usar `https://api.seudominio` ou `https://painel.seudominio`.

Edite .env, preserve os segredos gerados e configure:

```dotenv
PANEL_DOMAIN=painel.seudominio
API_DOMAIN=api.seudominio
TURN_DOMAIN=turn.seudominio
ACME_EMAIL=seu-email@seudominio
TURN_PUBLIC_IP=SEU_IPV4_PUBLICO
TURN_URLS=turn:turn.seudominio:3478?transport=udp,turn:turn.seudominio:3478?transport=tcp
TURN_TLS_ENABLED=0
```

Caddy provisiona HTTPS de painel/API automaticamente após DNS e portas corretos. Compose impõe NODE_ENV=production e origem HTTPS à API; cookies Secure não funcionam em HTTP. Nunca desabilite a verificação TLS no Android. TURN usa o mesmo TURN_SECRET que a API e emite senhas temporárias; ele não usa credencial de administrador.

```bash
./infrastructure/scripts/deploy.sh
docker compose run --rm -it api npm run bootstrap -w @arh/api
./infrastructure/scripts/health.sh
```

O bootstrap só cria o primeiro proprietário e pede senha oculta. Ative MFA no painel. O script de implantação verifica configuração, constrói imagens, aguarda banco, aplica migrações e inicia serviços. Faça backup antes de atualizar. Ao copiar uma versão nova, preserve .env, certificados e volumes; execute deploy.sh novamente. Não use `docker compose down -v` numa instalação com dados.

## Firewall

| Porta | Origem | Finalidade |
|---|---|---|
| TCP 22 | Somente IP administrativo ou VPN | SSH |
| TCP 80,443 | Internet | Desafio ACME, HTTPS/WSS |
| UDP 443 | Internet | HTTP/3 opcional |
| UDP/TCP 3478 | Internet | STUN/TURN autenticado |
| TCP 5349 | Internet, se TLS configurado | TURN TLS |
| UDP 49160–49200 | Internet | Portas relay Coturn |
| TCP 5432,3000,3001 | Não publicar | Serviços internos |

Implemente as regras no firewall da VPS/provedor e no host. Publicações Docker podem passar fora de regras UFW usuais; confirme externamente quais portas estão acessíveis. Coturn usa `network_mode: host` para Linux e o endereço público da VPS; o Compose de produção não é um ensaio de rede TURN no Docker Desktop do macOS.

## TURN TLS e rede

Para adicionar `turns:turn.seudominio:5349?transport=tcp`, instale certificado e cadeia válidos em `infrastructure/coturn/certs/fullchain.pem` e chave em `privkey.pem`, restritos ao administrador e legíveis pelo UID usado na imagem Coturn. Use um cliente ACME com validação DNS automatizada pelo seu provedor. Os certificados HTTPS do Caddy não são copiados automaticamente ao Coturn. Configure renovação com hook que atualize os arquivos atomicamente e reinicie o Coturn. Só então defina TURN_TLS_ENABLED=1 e acrescente a URL turns. `check-env` recusa turns anunciado sem os arquivos.

O TURN limita alocações e banda; `max-bps=2500000` representa bytes/s por direção por alocação, não bitrate de vídeo. Ajuste com cautela para seu plano. A 1,5 Mbit/s, uma hora de vídeo consome aproximadamente 675 MB por direção de mídia; o relay recebe e retransmite o fluxo. Monitore cobrança de tráfego, latência, CPU, memória e disco. Credenciais expiram em até dez minutos e nunca ficam no APK. Teste `iceTransportPolicy: relay` no painel e confirme candidato relay/bytes recebidos; só processo vivo não prova relay funcional.

## Backup e restauração

Gere a chave age em outra máquina: `age-keygen -o chave-backup.txt`. Guarde essa chave privada offline; leve apenas a chave pública `age1...` a BACKUP_AGE_RECIPIENT no .env. Guarde também uma cópia cifrada do .env/MASTER_KEY fora da VPS. Sem MASTER_KEY, os segredos MFA e tokens push não podem ser decifrados. O script de banco não inclui .env nem certificados.

```bash
./infrastructure/scripts/backup.sh
# Copie os .age para outro armazenamento sob seu controle.
# Para agendar: adapte caminhos e instale os dois arquivos de infrastructure/systemd.
sudo systemctl enable --now arh-backup.timer
```

O timer pressupõe os arquivos instalados em `/etc/systemd/system/`, projeto em `/opt/android-remote-hub`, age, Node e Docker disponíveis. Retenção local é BACKUP_RETENTION_DAYS. Teste restauração em ambiente isolado antes de depender do backup.

```bash
./infrastructure/scripts/restore.sh /backup/arh.dump.age /midia-offline/chave-backup.txt --replace-database
docker compose run --rm -it api npm run owner:reset
```

Restauração substitui dados: o argumento final é obrigatório. Todos os acessos administrativos, dispositivos e pareamentos restaurados são revogados. A conta fica bloqueada até a redefinição local da senha por owner:reset; MFA deve ser recadastrado e aparelhos pareados novamente. Isso impede reativar credenciais revogadas depois da data do backup. Falha no restore deixa consumidores parados; corrija e execute o procedimento novamente.

## Firebase opcional

Crie projeto Firebase seu e habilite FCM HTTP v1. Dê à conta de serviço apenas permissão de envio necessária e guarde o JSON fora do repositório (por exemplo `/etc/arh/firebase-service-account.json`). A API roda como UID1000: o arquivo montado precisa ser legível por esse UID. Uma opção é propriedade1000:1000 e modo0400, com acesso administrativo restrito no host. Um arquivo root:root0600 não será legível pela API; `secrets: file` do Compose local preserva as permissões do arquivo e não as corrige automaticamente. Defina FCM_SERVICE_ACCOUNT_HOST_FILE e use:

```bash
docker compose -f docker-compose.yml -f docker-compose.fcm.yml up -d --build
```

O override monta o JSON como secret em `/run/secrets/fcm_service_account`; não o coloque na imagem. Compile a variante Android Firebase com os parâmetros públicos listados em apps/android/README.md. As notificações só anunciam pedidos; compartilhar exige abrir o app e aceitar o diálogo nativo. Sem Firebase, a variante standalone funciona com o app aberto. Remover o override não desabilita a API principal.

## Monitoramento e manutenção

`docker compose ps`, logs de erro e `/api/v1/health` verificam serviços e consulta ao banco. Heartbeat informa conectividade; o painel tem diagnósticos WebRTC. Esses mecanismos são monitoramento básico, sem Prometheus/alerta externo. Configure monitor de disponibilidade sob seu controle se necessário. Rode `npm run cleanup -w @arh/api` diariamente (ou `docker compose exec -T api npm run cleanup -w @arh/api`) para aplicar retenção; os arquivos `arh-cleanup.service` e `arh-cleanup.timer` em infrastructure/systemd preparam esse agendamento. Atualize SO/imagens/pacotes após revisar mudanças e execute os testes antes de distribuir APK novo.

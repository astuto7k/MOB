# Manual do proprietário

**Antes de começar:** use apenas aparelhos seus, instale o aplicativo de forma visível e mantenha seu servidor atualizado. Anote o endereço HTTPS, e-mail do proprietário e local de seus códigos de recuperação. Feche conversas, bancos, autenticadores, notificações privadas e outros conteúdos sensíveis antes de compartilhar a tela. Uma transmissão autorizada pode mostrar conteúdo visível.

**Entrar:** abra o painel no navegador, informe e-mail/senha e, se ativo, o código do autenticador. Em Configurações, ative MFA e guarde os códigos de recuperação offline. Não envie esses códigos a outra pessoa.

**Adicionar aparelho:** escolha Adicionar dispositivo → Gerar código. No Android Remote Hub, informe o endereço do servidor, confira o destino, nomeie o aparelho e digite o código. Confirme no Android. O código expira em cinco minutos e só pode ser usado uma vez. Até cinco aparelhos podem permanecer pareados.

**Iniciar assistência:** mantenha o app Android aberto na variante sem Firebase. Escolha o aparelho no painel e solicite sessão. No Android, confira o pedido e escolha aceitar ou recusar. Aceitar ainda abre o diálogo oficial do sistema para compartilhar a tela. Você pode negar esse diálogo. O pareamento anterior não elimina essa confirmação.

**Visualizar:** o painel recebe vídeo após a autorização e negociação. A qualidade moderada é o ponto inicial; reduza a qualidade se a rede oscilar. Métricas só aparecem quando existem dados reais. Conteúdo protegido e tela bloqueada não são contornados.

**Controlar:** habilite manualmente o serviço de Acessibilidade depois de ler a explicação no Android. Autorize controle para a sessão atual. O primeiro escopo limita gestos e texto a aplicativos benignos permitidos; aplicativos financeiros e campos protegidos não são controlados. Você pode suspender o controle localmente e continuar só visualizando quando o estado permitir.

**Compartilhar arquivo:** o Android precisa selecionar o arquivo de origem ou confirmar o destino pelo seletor do sistema. O painel não navega livremente pelo armazenamento. Há progresso, limite de tamanho (até20MiB ou o valor menor configurado), hash de integridade e cancelamento. Um hash confirma conteúdo recebido, não transforma o arquivo em seguro para executar.

**Encerrar:** use Encerrar no Android, a ação da notificação ou Desconectar no painel. Bloqueio/perda de autorização também encerra. Para outra sessão, aceite um pedido novo no Android. Não existe retomada silenciosa.

**Revogar:** nos detalhes do dispositivo, escolha revogar e confirme. O aparelho perde autorização e precisa ser pareado novamente. Em Configurações, encerre navegadores administrativos que não usa. Não compartilhe o cookie, o código de pareamento ou o token do aparelho.

**Histórico:** consulte início, recusa, término e eventos de segurança. A auditoria não contém gravação da tela ou texto digitado. Se notar atividade desconhecida, encerre as sessões, revogue o aparelho/acesso e troque sua senha num navegador confiável.

**Problemas:** abra o app, confirme internet/servidor e leia [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Sem internet, nenhum novo consentimento é assumido. Recuperação de backup exige redefinição local da conta, MFA e novo pareamento, conforme o guia de implantação.

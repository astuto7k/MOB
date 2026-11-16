# Permissões Android

| Recurso | Motivo e consentimento | Como encerrar/desativar |
|---|---|---|
| INTERNET / ACCESS_NETWORK_STATE | Conectar ao servidor escolhido e informar tipo de rede. Não lê mensagens nem histórico. | Desparear ou desinstalar. |
| POST_NOTIFICATIONS (Android 13+) | Avisar pedidos e exibir atividade visível. Permissão negada é tratada, sem captura automática. | Configurações do Android → notificações. |
| FOREGROUND_SERVICE / MEDIA_PROJECTION | Manter compartilhamento consentido e visível; tipo `mediaProjection`. | Ação Encerrar na notificação, app, indicador do sistema ou bloqueio. |
| MediaProjection (diálogo por sessão) | Compartilhar uma tela/app selecionado pelo proprietário. Consentimento não é salvo. | Encerrar no Android ou negar o próximo pedido. |
| AccessibilityService (opcional) | Toques/gestos explícitos em apps benignos durante controle autorizado. Ativação manual após divulgação. | Suspender controle local ou desabilitar serviço em Acessibilidade. |
| Storage Access Framework | Escolher um arquivo ou destino para cada transferência. | Cancelar seletor/transferência. Sem MANAGE_EXTERNAL_STORAGE. |

Não há permissão de SMS, contatos, gravação de áudio, câmera, leitura das notificações, administrador de dispositivo ou boot para captura. O launcher e o serviço são identificáveis. Android Keystore protege a chave de cifra local; suporte a hardware depende do dispositivo. Não é necessário root.

**Android 14/API34:** consentimento por sessão e uso único de cada token/VirtualDisplay, callback MediaProjection e tipo foreground corretos. A captura redimensiona recursos existentes em vez de reutilizar tokens para abrir outra captura.

**Android 15/API35:** não inicia MediaProjection em BOOT_COMPLETED. Mudanças de serviço/bloqueio do fabricante podem interromper captura; a versão deve terminar e pedir nova aprovação.

**Android 16/API36 e Android 17/API37:** compilar com SDK atual não demonstra comportamento físico. Indicadores do sistema, bloqueio e gerenciamento de energia devem ser ensaiados por versão/OEM. O projeto usa APIs públicas; não contorna restrições posteriores. App targeting API37 deve ser testado antes de distribuição geral.

Em captura de app único, o mapeamento de coordenadas de acessibilidade para a tela inteira pode diferir. Controle deve ser recusado quando não houver mapeamento confiável; preferir somente visualização. Conteúdo FLAG_SECURE continua preto/indisponível.

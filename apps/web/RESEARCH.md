# Pesquisa do painel — 16/11/2026

Fontes primárias consultadas antes da implementação:

- [Instalação do Next.js](https://nextjs.org/docs/app/getting-started/installation): App Router, TypeScript, Tailwind e requisitos do Node.
- [Política de suporte do Next.js](https://nextjs.org/support-policy): priorizar a versão de segurança estável da linha suportada.
- [Implantação do Next.js](https://nextjs.org/docs/app/getting-started/deploying): execução com Node/Docker e saída standalone.
- [WebRTC: peer connections](https://webrtc.org/getting-started/peer-connections): oferta/resposta, sinalização fora do escopo WebRTC, ICE e trickle ICE.
- [W3C WebRTC](https://www.w3.org/TR/webrtc/): `RTCPeerConnection`, transceivers de recepção, DataChannel, estados e estatísticas.
- [shadcn/ui](https://ui.shadcn.com/docs): componentes locais e editáveis; padrão de Button/CVA e Dialog/Radix.
- [Tailwind para Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs): integração PostCSS da linha 4.

Os metadados oficiais npm `/latest` foram consultados diretamente para Next 16.4.6, React 19.3.1 e Tailwind 4.3.5; a equipe também validou as demais versões no registro antes da instalação. As versões exatas e integridades resolvidas são a fonte reproduzível no `package-lock.json` raiz. Bibliotecas auxiliares estão fixadas no manifesto; versões auxiliares anteriores ao `latest` podem ser mantidas quando compatíveis e verificadas pelo build. A aplicação não usa APIs experimentais de captura, plugins de navegador ou pacotes proprietários de acesso remoto.

Decisão: hospedar o painel junto com a API através de um proxy HTTPS na infraestrutura própria pedida. O ambiente Sites/Workers não é utilizado para substituir o backend NestJS/PostgreSQL/WebSocket ou hospedar o TURN.

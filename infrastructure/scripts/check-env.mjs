import { readFile, access } from 'node:fs/promises';
import { parse } from 'dotenv';
const vars = parse(await readFile(new URL('../../.env', import.meta.url)));
const errors = [];
for (const key of ['POSTGRES_PASSWORD', 'MASTER_KEY', 'TURN_SECRET']) {
  if (!vars[key] || vars[key].includes('REPLACE_')) errors.push(`${key}: gere um segredo com setup:env`);
}
if (Buffer.from(vars.MASTER_KEY || '', 'base64').length !== 32) errors.push('MASTER_KEY: precisa conter 32 bytes em base64');
if (!/^[a-f0-9]{64}$/.test(vars.POSTGRES_PASSWORD || '')) errors.push('POSTGRES_PASSWORD: use os 32 bytes hex gerados; evita ambiguidade na URI PostgreSQL');
if (process.argv.includes('--production')) {
  for (const key of ['PANEL_DOMAIN', 'API_DOMAIN', 'TURN_DOMAIN']) {
    if (!vars[key] || vars[key].endsWith('.exemplo.com') || !/^[a-zA-Z0-9.-]+$/.test(vars[key])) errors.push(`${key}: informe seu domínio real`);
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(vars.TURN_PUBLIC_IP || '')) errors.push('TURN_PUBLIC_IP: informe o IPv4 público da VPS');
  if (!vars.TURN_URLS?.includes(vars.TURN_DOMAIN)) errors.push('TURN_URLS: configure o relay próprio para redes distintas');
  if (vars.PANEL_DOMAIN === vars.API_DOMAIN) errors.push('API_DOMAIN: use outro subdomínio ou ajuste explicitamente o Caddyfile');
  if (vars.TURN_URLS?.includes('turns:')) {
    if (vars.TURN_TLS_ENABLED !== '1') errors.push('TURN_TLS_ENABLED: configure 1 ao anunciar turns:');
    for (const name of ['fullchain.pem', 'privkey.pem']) {
      try { await access(new URL(`../coturn/certs/${name}`, import.meta.url)); }
      catch { errors.push(`Coturn: instale certs/${name} antes de anunciar turns:`); }
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Configuração validada sem exibir segredos.');

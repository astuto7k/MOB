import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
const root = new URL('../../', import.meta.url);
for (const file of ['docker-compose.yml', 'docker-compose.dev.yml', 'docker-compose.fcm.yml', '.github/workflows/ci.yml']) {
  const document = parseDocument(await readFile(new URL(file, root), 'utf8'), { uniqueKeys: true });
  assert.equal(document.errors.length, 0, `${file}: ${document.errors.join(', ')}`);
  if (file === 'docker-compose.yml') {
    const config = document.toJS();
    assert.equal(config.services.postgres.ports, undefined, 'PostgreSQL de produção não pode publicar portas');
    assert.equal(config.services.api.ports, undefined, 'API deve ser alcançada pelo Caddy');
    assert.equal(config.services.web.ports, undefined, 'Painel deve ser alcançado pelo Caddy');
    assert.equal(config.networks.backend.internal, true);
  }
  console.log(`Configuração analisada: ${file}`);
}
console.log('Análise estática passou. Não substitui docker compose config/build/up numa VPS Linux.');

import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const password = randomBytes(32).toString('hex');
let value = await readFile(new URL('.env.example', root), 'utf8');
value = value.replaceAll('REPLACE_WITH_RANDOM_PASSWORD', password)
  .replace('REPLACE_WITH_32_RANDOM_BYTES_BASE64', randomBytes(32).toString('base64'))
  .replace('REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS', randomBytes(32).toString('hex'));
if (process.argv.includes('--pglite')) {
  value = value.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres');
}
try {
  await writeFile(new URL('.env', root), value, { flag: 'wx', mode: 0o600 });
  console.log(`Criado ${fileURLToPath(new URL('.env', root))}. Segredos não são exibidos. Configure domínios/IP antes de implantar.`);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error('.env já existe; nenhum valor foi substituído.');
  process.exitCode = 1;
}

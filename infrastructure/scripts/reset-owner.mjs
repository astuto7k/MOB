// Recuperação local da conta após restaurar um backup. Não é um endpoint remoto.
import { config as loadEnv } from 'dotenv';
import { createRequire } from 'node:module';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
if (!process.argv.includes('--after-restore')) throw new Error('Exige --after-restore e conta bloqueada pelo restore.');
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PrismaClient } = requireApi('@prisma/client');
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const argon2 = requireApi('argon2');
async function secret(prompt) {
  stdout.write(prompt); emitKeypressEvents(stdin); stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    const chars = [];
    const cleanup = () => { stdin.off('keypress', onKey); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Cancelado')); }
      else if (key.name === 'return') { cleanup(); resolve(chars.join('')); }
      else if (key.name === 'backspace') chars.pop();
      else if (str && !key.ctrl && !key.meta && chars.length < 128) chars.push(str);
    };
    stdin.on('keypress', onKey);
  });
}
let input;
if (stdin.isTTY) {
  const rl = createInterface({ input: stdin, output: stdout });
  const email = await new Promise(resolve => rl.question('E-mail da conta restaurada: ', resolve)); rl.close();
  const password = await secret('Nova senha (12–128 caracteres, entrada oculta): ');
  if (password !== await secret('Repita a senha: ')) throw new Error('Senhas diferentes.');
  input = { email, password };
} else {
  let data = ''; for await (const chunk of stdin) { data += chunk; if (data.length > 4096) throw new Error('Entrada excessiva.'); }
  input = JSON.parse(data);
}
if (typeof input.email !== 'string' || typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw new Error('E-mail e senha forte obrigatórios.');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const user = await db.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
  if (!user || !user.lockedUntil || user.lockedUntil.getUTCFullYear() < 9000) throw new Error('A conta não está bloqueada por uma restauração.');
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, lockedUntil: null, failedLoginCount: 0, mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaLastStep: null, recoveryHashes: [] } });
    await tx.auditEvent.create({ data: { ownerId: user.id, actorId: user.id, type: 'OWNER_RESET_AFTER_RESTORE' } });
  });
  console.log('Conta recuperada localmente. Ative MFA e pareie novamente os aparelhos.');
} finally { await db.$disconnect(); }

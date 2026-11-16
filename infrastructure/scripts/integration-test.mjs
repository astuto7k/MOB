// Testes reais de SQL/HTTP/WebSocket. Os clientes abaixo não são aparelhos Android.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PrismaClient } = requireApi('@prisma/client');
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { WebSocket } = requireApi('ws');
const argon2 = requireApi('argon2');
const { totp } = requireApi('./dist/crypto.js');
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const port = await freePort(), dbPort = await freePort();
let pg, socket, prisma, api, secondApi;
const sockets = [];
let log = '', checks = 0;
const ok = name => { checks++; console.log(`PASS ${name}`); };
const origin = 'http://localhost:3000';
const secret = randomBytes(32).toString('hex');
const databaseUrl = process.env.ARH_TEST_DATABASE_URL || `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
// PGlite has one PostgreSQL session: parallel extended-protocol clients can
// collide on unnamed prepared statements/portals. Production PostgreSQL retains
// the normal pool; only this embedded adapter runs the API pool serially.
const env = { ...process.env, DATABASE_URL: databaseUrl, DATABASE_POOL_SIZE: process.env.ARH_TEST_DATABASE_URL ? (process.env.DATABASE_POOL_SIZE || '5') : '1', NODE_ENV: 'test', PORT: String(port), WEB_ORIGIN: origin,
  MASTER_KEY: randomBytes(32).toString('base64'), TURN_SECRET: secret, TURN_URLS: 'turn:turn.example.test:3478?transport=udp',
  STUN_URLS: '', TRUST_PROXY: '0', FCM_SERVICE_ACCOUNT_FILE: '' };
const base = `http://127.0.0.1:${port}/api/v1`;
const wsUrl = `ws://127.0.0.1:${port}/api/v1/signaling`;
const password = randomBytes(24).toString('base64url');
const ownerEmail = `owner-${randomBytes(8).toString('hex')}@example.test`;
const otherEmail = `other-${randomBytes(8).toString('hex')}@example.test`;
async function request(path, { method = 'GET', body, auth, expected = 200, headers = {}, server = base } = {}) {
  const result = await fetch(`${server}${path}`, { method, headers: {
    Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(auth?.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}),
    ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const json = await result.json();
  assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
  return { json, response: result };
}
async function login(email, code) {
  const r = await request('/auth/login', { method: 'POST', body: { email, password, ...(code ? { totp: code } : {}) }, expected: 201 });
  const cookie = r.response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  assert.match(r.response.headers.get('set-cookie'), /HttpOnly/i);
  return { cookie, csrfToken: r.json.csrfToken, user: r.json.user };
}
async function pair(auth, name) {
  const code = (await request('/pairing', { method: 'POST', auth, expected: 201 })).json;
  return (await request('/pairing/confirm', { method: 'POST', body: { code: code.code, name, manufacturer: 'HTTP test client', model: 'API integration', androidVersion: 'not-hardware', appVersion: 'test' }, expected: 201 })).json;
}
async function open(auth) {
  const ws = new WebSocket(wsUrl, { headers: { Origin: origin, ...(auth.cookie ? { Cookie: auth.cookie } : { Authorization: `Bearer ${auth.token}` }) } });
  sockets.push(ws);
  const queue = [], waiters = [];
  ws.on('message', raw => {
    const value = JSON.parse(raw.toString()); const index = waiters.findIndex(w => w.predicate(value));
    if (index < 0) queue.push(value); else { const [w] = waiters.splice(index, 1); clearTimeout(w.timer); w.resolve(value); }
  });
  const next = predicate => new Promise((resolve, reject) => {
    const index = queue.findIndex(predicate); if (index >= 0) return resolve(queue.splice(index, 1)[0]);
    const w = { predicate, resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('Evento WebSocket não recebido')); }, 5000) }; waiters.push(w);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, next, send: value => ws.send(JSON.stringify(value)) };
}
try {
  if (process.env.ARH_TEST_DATABASE_URL) {
    // Apenas use um banco dedicado a testes. Prisma aplica migrações sem apagar tabelas.
    await new Promise((resolve, reject) => {
      const c = spawn('npm', ['run', 'db:migrate'], { cwd: root, env, stdio: 'inherit' });
      c.on('error', reject); c.on('exit', code => code === 0 ? resolve() : reject(new Error('Migração falhou')));
    });
  } else {
    pg = await PGlite.create();
    const dir = new URL('../../apps/api/prisma/migrations/', import.meta.url);
    for (const entry of (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await pg.exec(await readFile(new URL(`${entry.name}/migration.sql`, dir), 'utf8'));
    }
    socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: dbPort, maxConnections: 16 });
    await socket.start();
  }
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }) });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash } });
  const other = await prisma.user.create({ data: { email: otherEmail, passwordHash } });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', data => { log = (log + data).slice(-16000); });
  api.stderr.on('data', data => { log = (log + data).slice(-16000); });
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw new Error('API encerrou antes de ficar pronta');
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    if (i === 99) throw new Error('API não iniciou dentro do prazo');
    await delay(100);
  }
  await request('/health'); ok('saúde consulta o banco real de testes');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); sockets.push(ws); ws.on('error', () => {});
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Upgrade anônimo não foi recusado')); }, 5000);
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout); response.resume(); ws.terminate();
      try { assert.equal(response.statusCode, 401); resolve(); } catch (error) { reject(error); }
    });
    ws.once('open', () => { clearTimeout(timeout); reject(new Error('WebSocket anônimo aceito')); });
  }); ok('upgrade WebSocket sem autenticação recusado');
  await request('/devices', { expected: 401 });
  await request('/auth/login', { method: 'POST', body: { email: ownerEmail, password: 'invalid' }, expected: 401 });
  await request('/auth/login', { method: 'POST', body: { email: ownerEmail, password: 'astuto7k' }, expected: 401 });
  await request('/pairing/auto', { method: 'POST', body: {}, expected: 404 });
  const admin = await login(ownerEmail), otherAdmin = await login(otherEmail), secondAdmin = await login(ownerEmail);
  assert.equal((await request('/auth/me', { auth: admin })).json.user.email, ownerEmail); ok('autenticação, cookie HttpOnly e recurso protegido');
  await request('/pairing', { method: 'POST', auth: admin, headers: { 'X-CSRF-Token': 'invalid' }, expected: 403 });
  await request('/pairing', { method: 'POST', auth: admin, headers: { Origin: 'https://evil.example.test' }, expected: 403 }); ok('CSRF e origem incorreta recusados');
  const code = (await request('/pairing', { method: 'POST', auth: admin, expected: 201 })).json;
  const input = { code: code.code, name: 'Dispositivo de teste HTTP', manufacturer: 'Test', model: 'Fixture', androidVersion: 'test', appVersion: 'test' };
  const device = (await request('/pairing/confirm', { method: 'POST', body: input, expected: 201 })).json;
  await request('/pairing/confirm', { method: 'POST', body: input, expected: 400 });
  const otherDevice = await pair(otherAdmin, 'Outro proprietário');
  await request(`/devices/${device.device.id}`, { auth: otherAdmin, expected: 404 });
  await request('/device/heartbeat', { method: 'POST', auth: device, body: { battery: 73, charging: true, network: 'wifi', permissions: { mediaProjection: false, accessibility: false } }, expected: 201 });
  assert.equal((await request(`/devices/${device.device.id}`, { auth: admin })).json.battery, 73); ok('pareamento único, isolamento de proprietário e telemetria real');
  assert.equal((await request('/device/policy', { auth: device })).json.maxFileBytes, 20971520);
  await request('/device/policy', { auth: admin, expected: 403 });
  await request('/settings', { method: 'PATCH', auth: admin, body: { maxFileBytes: 4096 } });
  assert.equal((await request('/device/policy', { auth: device })).json.maxFileBytes, 4096); ok('política reduzida de arquivos disponível ao aparelho autorizado');
  const expiredPair = (await request('/pairing', { method: 'POST', auth: admin, expected: 201 })).json;
  await prisma.pairingRequest.update({ where: { id: expiredPair.id }, data: { expiresAt: new Date(0) } });
  await request('/pairing/confirm', { method: 'POST', body: { ...input, code: expiredPair.code }, expected: 400 });
  const revokedPair = (await request('/pairing', { method: 'POST', auth: admin, expected: 201 })).json;
  await request('/pairing/revoke', { method: 'POST', auth: admin, body: { id: revokedPair.id }, expected: 201 });
  await request('/pairing/confirm', { method: 'POST', body: { ...input, code: revokedPair.code }, expected: 400 }); ok('código expirado e revogado não pode ser usado');
  const session = (await request('/sessions', { method: 'POST', auth: admin, body: { deviceId: device.device.id, requestedControl: true }, expected: 201 })).json;
  assert.equal(session.status, 'WAITING_APPROVAL');
  assert.deepEqual(session.operator, {id:owner.id,email:ownerEmail});
  const deviceRequests=(await request('/device/requests',{auth:device})).json;
  assert.deepEqual(deviceRequests.find(s=>s.id===session.id).operator,{id:owner.id,email:ownerEmail});
  assert.equal(session.operator.passwordHash,undefined);
  ok('identidade do operador exibida ao aparelho sem campos secretos');
  await request(`/sessions/${session.id}/ice`, { auth: admin, expected: 409 });
  await request(`/sessions/${session.id}/signal`, { method: 'POST', auth: admin, body: { type: 'join', sessionId: session.id }, expected: 409 });
  await request(`/sessions/${session.id}/approve`, { method: 'POST', auth: admin, body: { control: true }, expected: 403 });
  await request(`/sessions/${session.id}/approve`, { method: 'POST', auth: otherDevice, body: { control: true }, expected: 404 });
  await request('/sessions', { method: 'POST', auth: admin, body: { deviceId: device.device.id, requestedControl: false }, expected: 409 }); ok('consentimento reservado ao aparelho correto e sessão concorrente recusada');
  const approved = (await request(`/sessions/${session.id}/approve`, { method: 'POST', auth: device, body: { control: true }, expected: 201 })).json;
  assert.equal(approved.controlApproved, true);
  await request(`/sessions/${session.id}/ice`, { auth: secondAdmin, expected: 403 });
  const ice = (await request(`/sessions/${session.id}/ice`, { auth: admin })).json;
  const turn = ice.iceServers.find(s => s.username);
  assert.equal(turn.credential, createHmac('sha1', secret).update(turn.username).digest('base64'));
  assert.ok(Number(turn.username.split(':')[0]) <= Math.floor(Date.now() / 1000) + 600); ok('credencial TURN temporária e vínculo ao acesso administrativo');
  // A cold Vercel instance must not reset passwords/MFA or end another instance's sessions.
  const secondPort = await freePort(), secondBase = `http://127.0.0.1:${secondPort}/api/v1`;
  secondApi = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: root, env: { ...env, PORT: String(secondPort), VERCEL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  secondApi.stdout.on('data', data => { log = (log + data).slice(-16000); });
  secondApi.stderr.on('data', data => { log = (log + data).slice(-16000); });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${secondBase}/health`)).ok) break; } catch {}
    if (secondApi.exitCode !== null || i === 99) throw new Error('Segunda instância não iniciou');
    await delay(100);
  }
  assert.equal((await request(`/sessions/${session.id}`, { auth: admin, server: secondBase })).json.status, 'APPROVED');
  const signalPath = `/sessions/${session.id}/signal`;
  await request(signalPath, { auth: secondAdmin, server: secondBase, expected: 403 });
  await request(signalPath, { auth: otherDevice, server: secondBase, expected: 404 });
  assert.equal((await request(signalPath, { method: 'POST', auth: admin, body: { type: 'join', sessionId: session.id }, expected: 201 })).json.peerPresent, false);
  assert.equal((await request(signalPath, { method: 'POST', auth: device, server: secondBase, body: { type: 'join', sessionId: session.id }, expected: 201 })).json.peerPresent, true);
  await request(signalPath, { method: 'POST', auth: device, server: secondBase, body: { type: 'offer', sessionId: session.id, payload: { type: 'offer', sdp: 'wrong-role' } }, expected: 403 });
  await request(signalPath, { method: 'POST', auth: admin, body: { type: 'offer', sessionId: session.id, payload: { type: 'offer', sdp: 'https-test-offer' } }, expected: 201 });
  const received = (await request(signalPath, { auth: device, server: secondBase })).json;
  assert.equal(received.messages[0].payload.sdp, 'https-test-offer');
  assert.equal((await request(`${signalPath}?after=${received.messages[0].seq}`, { auth: device, server: secondBase })).json.messages.length, 0);
  assert.equal((await request(signalPath, { auth: admin })).json.messages.length, 0);
  await request(signalPath, { method: 'POST', auth: device, server: secondBase, body: { type: 'answer', sessionId: session.id, payload: { type: 'answer', sdp: 'https-test-answer' } }, expected: 201 });
  assert.equal((await request(signalPath, { auth: admin })).json.messages[0].payload.sdp, 'https-test-answer');
  ok('sinalização HTTPS entre duas instâncias, cursor e isolamento de operador/aparelho');
  const browser = await open(admin), androidClient = await open(device);
  browser.send({ type: 'join', sessionId: session.id }); await browser.next(m => m.type === 'joined');
  androidClient.send({ type: 'join', sessionId: session.id }); await Promise.all([browser.next(m => m.type === 'peer-ready'), androidClient.next(m => m.type === 'peer-ready')]);
  browser.send({ type: 'offer', sessionId: session.id, payload: { type: 'offer', sdp: 'v=0\r\n' } });
  assert.equal((await androidClient.next(m => m.type === 'offer')).sessionId, session.id);
  androidClient.send({ type: 'answer', sessionId: session.id, payload: { type: 'answer', sdp: 'v=0\r\n' } });
  await browser.next(m => m.type === 'answer');
  await request(`/sessions/${session.id}/active`, { method: 'POST', auth: device, expected: 201 }); ok('negociação WebSocket autenticada e transição ACTIVE (sem teste de mídia)');
  await request('/files', { method: 'POST', auth: admin, body: { sessionId: session.id, direction: 'TO_DEVICE', name: '../unsafe', size: 1, sha256: '0'.repeat(64), status: 'REQUESTED' }, expected: 400 });
  await request('/files', { method: 'POST', auth: admin, body: { sessionId: session.id, direction: 'TO_DEVICE', name: 'large.txt', size: 4097, sha256: '0'.repeat(64), status: 'REQUESTED' }, expected: 400 });
  const file = (await request('/files', { method: 'POST', auth: device, body: { sessionId: session.id, direction: 'FROM_DEVICE', name: 'fixture.txt', size: 0, sha256: createHash('sha256').update('').digest('hex'), status: 'COMPLETED' }, expected: 201 })).json;
  assert.ok(file.id); ok('validação de metadados de arquivo e nome seguro');
  await request(`/sessions/${session.id}/control/revoke`, { method: 'POST', auth: device, expected: 201 });
  assert.equal((await request(`/sessions/${session.id}`, { auth: device })).json.controlApproved, false);
  await request(`/devices/${device.device.id}`, { method: 'DELETE', auth: admin });
  assert.equal((await request(`/sessions/${session.id}`, { auth: admin })).json.status, 'ENDED');
  await request('/device/heartbeat', { method: 'POST', auth: device, body: {}, expected: 401 });
  await request(`/sessions/${session.id}/active`, { method: 'POST', auth: device, expected: 401 });
  assert.equal(await prisma.sessionPermission.count({ where: { sessionId: session.id, revokedAt: null } }), 0); ok('revogação durante sessão invalida credencial e todas as permissões');
  const afterEnd = await open(admin); afterEnd.send({ type: 'join', sessionId: session.id });
  await afterEnd.next(m => m.type === 'error'); ok('sinalização após encerramento recusada');
  // Limite de 100 só considera aparelhos não revogados. Todos são fixtures descartáveis.
  await prisma.device.createMany({ data: Array.from({ length: 95 }, (_, i) => ({ ownerId: owner.id, name: `Limit fixture ${i}`, manufacturer: 'Test', model: 'Fixture', androidVersion: 'test', appVersion: 'test' })) });
  for (let i = 0; i < 4; i++) await pair(admin, `Fixture ${i}`);
  const spare = (await request('/pairing', { method: 'POST', auth: admin, expected: 201 })).json;
  const fifth = await pair(admin, 'Fixture quinto');
  await request('/pairing/confirm', { method: 'POST', body: { ...input, code: spare.code }, expected: 409 });
  await request('/pairing', { method: 'POST', auth: admin, expected: 409 }); ok('limite de 100 aparelhos aplicado também na confirmação');
  const denied = (await request('/sessions', { method: 'POST', auth: admin, body: { deviceId: fifth.device.id, requestedControl: false }, expected: 201 })).json;
  await request(`/sessions/${denied.id}/reject`, { method: 'POST', auth: fifth, expected: 201 });
  await request(`/sessions/${denied.id}/approve`, { method: 'POST', auth: fifth, body: { control: false }, expected: 409 }); ok('recusa é terminal e não pode virar aprovação');
  const malformedSession = (await request('/sessions', { method: 'POST', auth: admin, body: { deviceId: fifth.device.id, requestedControl: false }, expected: 201 })).json;
  await request(`/sessions/${malformedSession.id}/approve`, { method: 'POST', auth: fifth, body: { control: false }, expected: 201 });
  const malformedBrowser = await open(admin), malformedDevice = await open(fifth);
  malformedBrowser.send({ type: 'join', sessionId: malformedSession.id }); await malformedBrowser.next(m => m.type === 'joined');
  malformedDevice.send({ type: 'join', sessionId: malformedSession.id }); await malformedBrowser.next(m => m.type === 'peer-ready');
  malformedBrowser.send({ type: 'control', sessionId: malformedSession.id, payload: { type: 'tap', x: 0.5, y: 0.5 } });
  await malformedBrowser.next(m => m.type === 'error');
  for (let i = 0; i < 30; i++) {
    if ((await request(`/sessions/${malformedSession.id}`, { auth: admin })).json.status === 'ENDED') break;
    await delay(50);
  }
  assert.equal((await request(`/sessions/${malformedSession.id}`, { auth: admin })).json.status, 'ENDED'); ok('mensagem fora do contrato encerra a sinalização');
  const expiring = (await request('/sessions', { method: 'POST', auth: admin, body: { deviceId: fifth.device.id, requestedControl: false }, expected: 201 })).json;
  await prisma.remoteSession.update({ where: { id: expiring.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request(`/sessions/${expiring.id}`, { auth: admin })).json.status, 'EXPIRED'); ok('expiração de sessão aplicada sem renovação automática');
  const setup = (await request('/auth/mfa/setup', { method: 'POST', auth: admin, expected: 201 })).json;
  const step = Math.floor(Date.now() / 30000);
  const enabled = (await request('/auth/mfa/enable', { method: 'POST', auth: admin, body: { code: totp(setup.secret, step - 1) }, expected: 201 })).json;
  const dbOwner = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.notEqual(dbOwner.mfaSecret, setup.secret); assert.equal(enabled.recoveryCodes.length, 10);
  await request('/auth/login', { method: 'POST', body: { email: ownerEmail, password }, expected: 401 });
  await login(ownerEmail, totp(setup.secret, step));
  await request('/auth/login', { method: 'POST', body: { email: ownerEmail, password, totp: totp(setup.secret, step) }, expected: 401 }); ok('MFA real, segredo cifrado e replay TOTP recusado');
  await request('/auth/recovery', { method: 'POST', body: { email: ownerEmail, recoveryCode: enabled.recoveryCodes[0], newPassword: password }, expected: 201 });
  await request('/auth/me', { auth: admin, expected: 401 });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).recoveryHashes.length, 9); ok('recuperação consome código e revoga acessos');
  const events = (await request('/audit', { auth: otherAdmin })).json;
  assert.ok(events.every(e => e.ownerId === other.id));
  await prisma.deviceCredential.updateMany({ where: { deviceId: otherDevice.device.id }, data: { expiresAt: new Date(0) } });
  await request('/device/requests', { auth: otherDevice, expected: 401 }); ok('auditoria por proprietário e bearer expirado recusado');
  await request('/auth/logout', { method: 'POST', auth: otherAdmin, expected: 201 });
  await request('/auth/me', { auth: otherAdmin, expected: 401 }); ok('logout invalida a sessão administrativa no servidor');
  let rateLimited = false;
  for (let i = 0; i < 22; i++) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: 'missing@example.test', password: 'invalid' }) });
    if (r.status === 429) { rateLimited = true; break; }
  }
  assert.ok(rateLimited); ok('limite de tentativas HTTP aplicado');
  console.log(`\n${checks} verificações de integração passaram. Android, vídeo e TURN real não foram exercitados por estes testes.`);
} catch (error) {
  console.error(error); if (log) console.error(log); process.exitCode = 1;
} finally {
  if (secondApi) { secondApi.kill('SIGTERM'); await Promise.race([new Promise(resolve => secondApi.once('exit', resolve)), delay(3000)]); if (secondApi.exitCode === null) secondApi.kill('SIGKILL'); }
  for (const ws of sockets) ws.terminate();
  if (api) {
    api.kill('SIGTERM');
    await Promise.race([new Promise(resolve => api.once('exit', resolve)), delay(5000)]);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  await prisma?.$disconnect();
  await socket?.stop(); await pg?.close();
}

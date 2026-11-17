import { readFile, copyFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const flag = process.argv.indexOf('--signing-file');
if (flag < 0 || !process.argv[flag + 1]) throw new Error('Use --signing-file /caminho/privado/signing.json. Nunca versione a chave ou sua senha.');
const settings = JSON.parse(await readFile(resolve(process.argv[flag + 1]), 'utf8'));
const env = { ...process.env };
for (const key of ['ARH_KEYSTORE_PATH', 'ARH_KEYSTORE_PASSWORD', 'ARH_KEY_ALIAS', 'ARH_KEY_PASSWORD']) {
  if (typeof settings[key] !== 'string' || !settings[key]) throw new Error(`Configuração privada incompleta: ${key}`);
  env[key] = settings[key];
}
await access(env.ARH_KEYSTORE_PATH);
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { cwd: join(root, 'apps/android'), env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Falha ao executar ${command}`);
  return result.stdout ?? '';
};
run('./gradlew', ['--no-daemon', 'assembleStandaloneRelease', 'testStandaloneDebugUnitTest', 'lintStandaloneRelease']);
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Configure ANDROID_HOME ou ANDROID_SDK_ROOT.');
const tools = join(sdk, 'build-tools/36.0.0');
const apk = join(root, 'apps/android/app/build/outputs/apk/standalone/release/app-standalone-release.apk');
run(join(tools, 'apksigner'), ['verify', '--verbose', apk]);
const manifest = run(join(tools, 'aapt'), ['dump', 'badging', apk], true);
if (manifest.includes('application-debuggable')) throw new Error('O APK publicado não pode ser debuggable.');
for (const target of ['MOB.apk', 'apps/web/public/apk/MOB.apk']) await copyFile(apk, join(root, target));
const sha = createHash('sha256').update(await readFile(apk)).digest('hex');
await writeFile(join(root, 'docs/APK-SHA256SUMS'), `${sha}  MOB.apk\n${sha}  apps/web/public/apk/MOB.apk\n`);
console.log(`APK release verificado e copiado. SHA-256: ${sha}`);

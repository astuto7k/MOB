import { isEntrypoint } from './entry.js';
import 'reflect-metadata';
import { z } from 'zod';
import { Db } from './db.js';

/** Optional deploy-time first owner. Never resets an existing account or MFA. */
export async function cloudBootstrap(db: Db, input = process.env) {
  if (!input.BOOTSTRAP_OWNER_EMAIL && !input.BOOTSTRAP_OWNER_HASH) return;
  const owner = z.object({
    BOOTSTRAP_OWNER_EMAIL: z.email().transform(s => s.toLowerCase()),
    BOOTSTRAP_OWNER_HASH: z.string().regex(/^\$argon2id\$v=19\$/),
  }).parse(input);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(716317005)`;
    if (await tx.user.count()) return;
    const user = await tx.user.create({ data: { email: owner.BOOTSTRAP_OWNER_EMAIL, passwordHash: owner.BOOTSTRAP_OWNER_HASH } });
    await tx.systemSettings.create({ data: { ownerId: user.id } });
    await tx.auditEvent.create({ data: { ownerId: user.id, actorId: user.id, type: 'OWNER_BOOTSTRAPPED' } });
  });
}
if (isEntrypoint(import.meta.url)) {
  const db = new Db();
  void cloudBootstrap(db).finally(() => db.$disconnect()).catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN';
    console.error('Cloud owner bootstrap failed:', error instanceof Error ? error.name : 'UnknownError', code);
    process.exitCode = 1;
  });
}

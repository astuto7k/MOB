import {config as loadEnv} from 'dotenv';
import {fileURLToPath} from 'node:url';
loadEnv({path:fileURLToPath(new URL('../../.env',import.meta.url)),quiet:true});
import { defineConfig } from 'prisma/config';
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL ?? 'postgresql://hub:hub@127.0.0.1:5432/hub' } });

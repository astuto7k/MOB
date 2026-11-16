import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({path:resolve(__dirname,'../../../.env'),quiet:true});
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','production','test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(10).default(5),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  MASTER_KEY: z.string().refine(v => Buffer.from(v,'base64').length === 32,'Must be 32 random bytes encoded as base64'),
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  DEVICE_CREDENTIAL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  TURN_SECRET: z.string().min(32).optional(),
  TURN_URLS: z.string().default(''),
  STUN_URLS: z.string().default(''),
  TRUST_PROXY: z.enum(['0','1']).default('0'),
  FCM_PROJECT_ID: z.string().optional(),
});
export const config = schema.parse(process.env);
export const cookieName = config.NODE_ENV === 'production' ? '__Host-arh_admin' : 'arh_admin';
export const secureCookie = config.NODE_ENV === 'production';

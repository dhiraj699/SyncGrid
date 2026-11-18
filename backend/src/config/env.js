import 'dotenv/config';
import crypto from 'node:crypto';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
    CORS_ORIGIN: z.string().optional(),
    STORE_DRIVER: z.enum(['mongo', 'memory']).default('mongo'),
    MONGODB_URI: z.string().optional(),
    DEMO_PASSWORD: z.string().min(1).default(() => process.env.DEMO_PASSWORD || 'demo-password'),
    JWT_SECRET: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().min(32).default(() => process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')),
    ),
    JWT_TTL: z.string().default('12h'),
    SEQUENCER_TICK_MS: z.coerce.number().int().min(1).max(250).default(8),
    PERSIST_DEBOUNCE_MS: z.coerce.number().int().min(10).default(2000),
    PERSIST_MAX_WAIT_MS: z.coerce.number().int().min(100).default(10000),
    SEED_ROWS: z.coerce.number().int().min(1).max(20000).default(5000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.STORE_DRIVER === 'mongo' && !env.MONGODB_URI) {
      ctx.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'Required when STORE_DRIVER=mongo' });
    }
    if (env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Must be explicitly set in environment in production' });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = Object.freeze(parsed.data);

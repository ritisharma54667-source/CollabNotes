import 'dotenv/config';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').optional(),
  /** PostgreSQL connection string, e.g. postgres://user:pass@host:5432/dbname (add ?sslmode=require for managed hosts). */
  DATABASE_URL: z.string().optional(),
  /** Schema to use (defaults to `public`). Tests use a throw-away schema per run. */
  DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/i, 'DB_SCHEMA must be a simple identifier').optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Comma-separated list of extra allowed browser origins (CORS + WebSocket). */
  CORS_ORIGINS: z.string().default(''),
  /** Directory with the built client. When set, the server also serves the SPA. */
  STATIC_DIR: z.string().optional(),
  /** Number of reverse proxies in front of the app (needed for correct client IPs). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  isTest: boolean;
  port: number;
  jwtSecret: string;
  databaseUrl: string;
  dbSchema?: string;
  dbPoolMax: number;
  corsOrigins: string[];
  staticDir?: string;
  trustProxy: number;
  bcryptRounds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` lines in a copied .env.example mean "unset", not an empty value.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  if (isProd && !e.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  if (isProd && !e.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set when NODE_ENV=production');
  }
  const defaultDevOrigins = isProd ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const extra = e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    env: e.NODE_ENV,
    isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    jwtSecret: e.JWT_SECRET ?? DEV_SECRET,
    databaseUrl: e.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/collab_notes',
    dbSchema: e.DB_SCHEMA,
    dbPoolMax: e.DB_POOL_MAX,
    corsOrigins: [...defaultDevOrigins, ...extra],
    staticDir: e.STATIC_DIR,
    trustProxy: e.TRUST_PROXY,
    bcryptRounds: e.BCRYPT_ROUNDS,
  };
}

export const config = loadConfig();

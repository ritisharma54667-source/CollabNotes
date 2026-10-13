import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

export type Role = 'owner' | 'editor' | 'viewer';
export type DocType = 'notes' | 'whiteboard' | 'tasks';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Every connection uses the configured schema (the default `public` when unset).
  options: config.dbSchema ? `-c search_path=${config.dbSchema}` : undefined,
});

// An idle client erroring (e.g. the database restarted) must not crash the process.
pool.on('error', (err) => logger.error('Unexpected PostgreSQL pool error', { error: err.message }));

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) =>
  pool.query<T>(text, params);

export async function one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await pool.query<T>(text, params)).rows[0];
}

export async function many<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

/** Runs `fn` in a transaction: commits on success, rolls back (and rethrows) on any error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

// ---------- migrations ----------

/**
 * Append-only list of migrations. Never edit one that has shipped — add a new entry instead.
 * Each runs once, inside a transaction, and is recorded in `schema_migrations`.
 */
const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('notes', 'whiteboard', 'tasks')),
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        yjs_state BYTEA,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE document_members (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        PRIMARY KEY (document_id, user_id)
      );
      CREATE INDEX idx_members_user ON document_members(user_id);

      CREATE TABLE document_invites (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        state BYTEA NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_versions_doc ON document_versions(document_id, created_at DESC);
      CREATE INDEX idx_documents_updated ON documents(updated_at DESC);
    `,
  },
  {
    id: 2,
    name: 'single-use invites',
    sql: `
      ALTER TABLE document_invites
        ADD COLUMN single_use BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN used_at TIMESTAMPTZ;
      CREATE INDEX idx_invites_doc ON document_invites(document_id);
    `,
  },
];

/** Applies pending migrations. Safe to call from several instances at once (advisory lock). */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    // Serialises concurrent starters; released automatically if this connection dies.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
    );
    const applied = new Set((await client.query<{ id: number }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await client.query('COMMIT');
        logger.info('Applied migration', { id: m.id, name: m.name });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.id} (${m.name}) failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

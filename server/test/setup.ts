import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll } from 'vitest';

/**
 * Every test file gets its own PostgreSQL schema, so files can run in parallel against one database
 * and nothing is left behind afterwards.
 */
const schema = `t_${randomBytes(6).toString('hex')}`;
process.env.DB_SCHEMA = schema;

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await admin.connect();
} catch (err) {
  throw new Error(
    `Cannot connect to PostgreSQL at ${process.env.DATABASE_URL}.\n` +
      'Start one with `docker compose up -d db` (then create the test database, see README) or set TEST_DATABASE_URL.\n' +
      String(err)
  );
}
await admin.query(`CREATE SCHEMA ${schema}`);

const { migrate, pool } = await import('../src/db.js');
await migrate();

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

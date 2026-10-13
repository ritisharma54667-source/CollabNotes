import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, query } from '../src/db.js';
import { app, auth, getTicket, makeDoc, signup, startServer, TestClient, waitFor } from './helpers.js';

describe('database behaviour', () => {
  it('migrations are idempotent and safe to run concurrently', async () => {
    await Promise.all([migrate(), migrate(), migrate()]);
    const { rows } = await query<{ id: number }>('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual([1, 2]); // every migration recorded exactly once
  });

  it('lets exactly one of several simultaneous sign-ups with the same email win', async () => {
    const email = `race${Date.now()}@example.com`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => request(app).post('/api/auth/register').send({ email, name: 'Racer', password: 'password123' }))
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    const { rows } = await query('SELECT 1 FROM users WHERE email = $1', [email]);
    expect(rows).toHaveLength(1);
  });

  it('reports readiness from the database', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('returns timestamps as ISO strings the client can parse', async () => {
    const { token } = await signup();
    await makeDoc(token);
    const list = await request(app).get('/api/documents').set(auth(token));
    expect(list.body.documents[0].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
  });

  it('deleting a document cascades to members, invites and versions', async () => {
    const { token } = await signup();
    const doc = await makeDoc(token);
    await request(app).post(`/api/documents/${doc.id}/invites`).set(auth(token)).send({ role: 'viewer' });
    await request(app).post(`/api/documents/${doc.id}/versions`).set(auth(token)).send({ label: 'x' });
    await request(app).delete(`/api/documents/${doc.id}`).set(auth(token));
    for (const table of ['document_members', 'document_invites', 'document_versions']) {
      const { rows } = await query(`SELECT 1 FROM ${table} WHERE document_id = $1`, [doc.id]);
      expect(rows, table).toHaveLength(0);
    }
  });

  it('rejects expired invite links', async () => {
    const { token } = await signup();
    const guest = await signup();
    const doc = await makeDoc(token);
    const inv = await request(app).post(`/api/documents/${doc.id}/invites`).set(auth(token)).send({ role: 'editor' });
    await query("UPDATE document_invites SET expires_at = now() - interval '1 minute' WHERE document_id = $1", [doc.id]);
    const res = await request(app).get(`/api/invites/${inv.body.invite.token}`).set(auth(guest.token));
    expect(res.status).toBe(404);
  });
});

describe('collaboration backed by PostgreSQL', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const text = (c: TestClient) => c.doc.getText('t').toString();

  it('reloads a document from the database after every client has left', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);

    const a = new TestClient(server.port, doc.id, await getTicket(owner.token, doc.id));
    await waitFor(() => a.synced);
    a.doc.getText('t').insert(0, 'survives a restart');
    await new Promise((r) => setTimeout(r, 50));
    a.close();

    // the room is flushed to PostgreSQL and removed from memory
    await waitFor(async () => {
      const { rows } = await query('SELECT yjs_state FROM documents WHERE id = $1', [doc.id]);
      return rows[0].yjs_state !== null;
    });
    await new Promise((r) => setTimeout(r, 100));

    const b = new TestClient(server.port, doc.id, await getTicket(owner.token, doc.id));
    await waitFor(() => b.synced);
    expect(text(b)).toBe('survives a restart');
    b.close();
  });

  it('two clients joining a not-yet-loaded document at the same moment share one room', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    const [t1, t2] = await Promise.all([getTicket(owner.token, doc.id), getTicket(owner.token, doc.id)]);

    const [a, b] = [new TestClient(server.port, doc.id, t1), new TestClient(server.port, doc.id, t2)];
    await waitFor(() => a.synced && b.synced);

    a.doc.getText('t').insert(0, 'one room');
    await waitFor(() => text(b) === 'one room');
    b.doc.getText('t').insert(8, '!');
    await waitFor(() => text(a) === 'one room!');
    a.close();
    b.close();
  });

  it('does not lose an edit made while a save is in flight', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    const a = new TestClient(server.port, doc.id, await getTicket(owner.token, doc.id));
    await waitFor(() => a.synced);

    for (let i = 0; i < 20; i++) {
      a.doc.getText('t').insert(a.doc.getText('t').length, String(i % 10));
      await new Promise((r) => setTimeout(r, 5));
    }
    const expected = text(a);
    a.close();

    await waitFor(async () => {
      const { rows } = await query('SELECT yjs_state FROM documents WHERE id = $1', [doc.id]);
      return rows[0].yjs_state !== null;
    });
    await new Promise((r) => setTimeout(r, 200));
    const b = new TestClient(server.port, doc.id, await getTicket(owner.token, doc.id));
    await waitFor(() => b.synced);
    expect(text(b)).toBe(expected);
    b.close();
  });
});

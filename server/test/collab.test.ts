import request from 'supertest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadYjsState } from '../src/documents.js';
import { app, auth, getTicket, makeDoc, shareWith, signup, startServer, TestClient, waitFor } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.close();
});

const text = (c: TestClient) => c.doc.getText('t').toString();

async function connect(token: string, docId: string) {
  const c = new TestClient(server.port, docId, await getTicket(token, docId));
  await waitFor(() => c.synced);
  return c;
}

function expectRejected(url: string) {
  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url);
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => resolve(101));
    ws.on('error', () => {});
  });
}

describe('websocket collaboration', () => {
  it('syncs edits between two clients and persists them', async () => {
    const owner = await signup('A');
    const guest = await signup('B');
    const doc = await makeDoc(owner.token);
    await shareWith(owner.token, doc.id, guest.token, 'editor');

    const a = await connect(owner.token, doc.id);
    const b = await connect(guest.token, doc.id);

    a.doc.getText('t').insert(0, 'hello');
    await waitFor(() => text(b) === 'hello');
    b.doc.getText('t').insert(5, ' world');
    await waitFor(() => text(a) === 'hello world');

    a.close();
    b.close();
    // the last client leaving flushes state to the database
    await waitFor(async () => (await loadYjsState(doc.id)) !== null);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await loadYjsState(doc.id))!);
    expect(restored.getText('t').toString()).toBe('hello world');
  });

  it('a late joiner receives existing content', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    const a = await connect(owner.token, doc.id);
    a.doc.getText('t').insert(0, 'persisted');
    await new Promise((r) => setTimeout(r, 50));
    const b = await connect(owner.token, doc.id);
    expect(text(b)).toBe('persisted');
    a.close();
    b.close();
  });

  it('drops document updates from viewers but lets them read', async () => {
    const owner = await signup();
    const viewer = await signup();
    const doc = await makeDoc(owner.token);
    await shareWith(owner.token, doc.id, viewer.token, 'viewer');

    const a = await connect(owner.token, doc.id);
    const v = await connect(viewer.token, doc.id);

    a.doc.getText('t').insert(0, 'by owner');
    await waitFor(() => text(v) === 'by owner');

    v.doc.getText('t').insert(0, 'HACK ');
    await new Promise((r) => setTimeout(r, 200));
    expect(text(a)).toBe('by owner');
    a.close();
    v.close();
  });

  it('rejects connections without a valid ticket, for strangers, and for the wrong document', async () => {
    const owner = await signup();
    const stranger = await signup();
    const doc = await makeDoc(owner.token);
    const other = await makeDoc(owner.token);
    const base = `ws://127.0.0.1:${server.port}/ws`;

    expect(await expectRejected(`${base}/${doc.id}`)).toBe(401);
    expect(await expectRejected(`${base}/${doc.id}?ticket=garbage`)).toBe(401);
    // the long-lived access token must not work as a ticket
    expect(await expectRejected(`${base}/${doc.id}?ticket=${owner.token}`)).toBe(401);
    // a ticket is bound to one document
    expect(await expectRejected(`${base}/${other.id}?ticket=${await getTicket(owner.token, doc.id)}`)).toBe(401);
    // a stranger cannot even obtain a ticket
    const res = await request(app).post(`/api/documents/${doc.id}/ws-ticket`).set(auth(stranger.token));
    expect(res.status).toBe(404);
    // browsers from other origins are refused
    const evil = new Promise<number>((resolve) => {
      const ws = new WebSocket(`${base}/${doc.id}?ticket=${owner.token}`, { headers: { Origin: 'https://evil.example' } });
      ws.on('unexpected-response', (_r, r) => resolve(r.statusCode ?? 0));
    });
    expect(await evil).toBe(403);
  });

  it('survives malformed messages without crashing the server', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    const ticket = await getTicket(owner.token, doc.id);
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/${doc.id}?ticket=${ticket}`);
    const closed = new Promise<number>((resolve) => ws.on('close', resolve));
    await new Promise((r) => ws.on('open', r));
    ws.send(Buffer.from([0, 99, 255, 255, 255]));
    expect(await closed).toBe(1003);

    // the server is still healthy for other clients
    const c = await connect(owner.token, doc.id);
    expect(c.synced).toBe(true);
    c.close();
  });

  it('kicks a member whose access was revoked while connected', async () => {
    const owner = await signup();
    const guest = await signup();
    const doc = await makeDoc(owner.token);
    await shareWith(owner.token, doc.id, guest.token, 'editor');
    const g = await connect(guest.token, doc.id);

    await request(app).delete(`/api/documents/${doc.id}/members/${guest.user.id}`).set(auth(owner.token));
    await waitFor(() => g.closeCode !== null);
    expect(g.closeCode).toBe(4403);
  });
});

describe('version history', () => {
  it('saves a version and restores it into the live document', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token, 'tasks');
    const live = await connect(owner.token, doc.id);
    const tasks = () => live.doc.getArray<Y.Map<unknown>>('tasks');

    const add = (title: string) => {
      const m = new Y.Map<unknown>();
      m.set('text', title);
      tasks().push([m]);
    };
    add('first');
    await new Promise((r) => setTimeout(r, 50));

    const saved = await request(app).post(`/api/documents/${doc.id}/versions`).set(auth(owner.token)).send({ label: 'v1' });
    expect(saved.status).toBe(201);

    add('second');
    await waitFor(() => tasks().length === 2);
    await new Promise((r) => setTimeout(r, 50));

    const restore = await request(app)
      .post(`/api/documents/${doc.id}/versions/${saved.body.version.id}/restore`)
      .set(auth(owner.token));
    expect(restore.status).toBe(200);
    await waitFor(() => tasks().length === 1);
    expect(tasks().get(0).get('text')).toBe('first');

    const versions = await request(app).get(`/api/documents/${doc.id}/versions`).set(auth(owner.token));
    const labels = versions.body.versions.map((v: { label: string }) => v.label);
    expect(labels).toEqual(expect.arrayContaining(['v1', 'Before restore']));
    live.close();
  });
});

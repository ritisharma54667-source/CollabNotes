import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { insertVersion, MAX_ACTIVE_INVITES, MAX_VERSIONS } from '../src/documents.js';
import { getRoom } from '../src/collab/rooms.js';
import { app, auth, getTicket, makeDoc, signup, startServer, waitFor } from './helpers.js';

const invite = (token: string, docId: string, body: object = { role: 'editor' }) =>
  request(app).post(`/api/documents/${docId}/invites`).set(auth(token)).send(body);

describe('invite links: list, revoke, single use', () => {
  it('lists live links for the owner only, without exposing tokens', async () => {
    const owner = await signup('Owner');
    const editor = await signup('Editor');
    const doc = await makeDoc(owner.token);
    const created = await invite(owner.token, doc.id, { role: 'viewer', singleUse: true });
    expect(created.status).toBe(201);
    expect(created.body.invite).toMatchObject({ role: 'viewer', singleUse: true });

    const list = await request(app).get(`/api/documents/${doc.id}/invites`).set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body.invites).toHaveLength(1);
    expect(list.body.invites[0]).toMatchObject({ id: created.body.invite.id, role: 'viewer', singleUse: true, createdBy: 'Owner' });
    expect(JSON.stringify(list.body)).not.toContain(created.body.invite.token);

    // members who are not the owner cannot see or manage links
    const inv = await invite(owner.token, doc.id);
    await request(app).post(`/api/invites/${inv.body.invite.token}/accept`).set(auth(editor.token));
    expect((await request(app).get(`/api/documents/${doc.id}/invites`).set(auth(editor.token))).status).toBe(403);
    expect(
      (await request(app).delete(`/api/documents/${doc.id}/invites/${created.body.invite.id}`).set(auth(editor.token))).status
    ).toBe(403);
  });

  it('a revoked link stops working for preview and accept', async () => {
    const owner = await signup();
    const guest = await signup('Guest');
    const doc = await makeDoc(owner.token);
    const { body } = await invite(owner.token, doc.id);

    expect((await request(app).get(`/api/invites/${body.invite.token}`).set(auth(guest.token))).status).toBe(200);
    const del = await request(app).delete(`/api/documents/${doc.id}/invites/${body.invite.id}`).set(auth(owner.token));
    expect(del.status).toBe(204);

    expect((await request(app).get(`/api/invites/${body.invite.token}`).set(auth(guest.token))).status).toBe(404);
    expect((await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(guest.token))).status).toBe(404);
    const list = await request(app).get(`/api/documents/${doc.id}/invites`).set(auth(owner.token));
    expect(list.body.invites).toHaveLength(0);
    // revoking twice is a clean 404
    expect((await request(app).delete(`/api/documents/${doc.id}/invites/${body.invite.id}`).set(auth(owner.token))).status).toBe(404);
  });

  it("cannot revoke another document's invite through your own document's route", async () => {
    const a = await signup('A');
    const b = await signup('B');
    const docA = await makeDoc(a.token);
    const docB = await makeDoc(b.token);
    const invB = await invite(b.token, docB.id);
    const res = await request(app).delete(`/api/documents/${docA.id}/invites/${invB.body.invite.id}`).set(auth(a.token));
    expect(res.status).toBe(404);
    expect((await request(app).get(`/api/invites/${invB.body.invite.token}`).set(auth(a.token))).status).toBe(200);
  });

  it('multi-use links keep working for several people', async () => {
    const owner = await signup();
    const g1 = await signup('G1');
    const g2 = await signup('G2');
    const doc = await makeDoc(owner.token);
    const { body } = await invite(owner.token, doc.id);
    expect((await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(g1.token))).status).toBe(200);
    expect((await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(g2.token))).status).toBe(200);
  });

  it('a single-use link works once, then is dead', async () => {
    const owner = await signup();
    const g1 = await signup('G1');
    const g2 = await signup('G2');
    const doc = await makeDoc(owner.token);
    const { body } = await invite(owner.token, doc.id, { role: 'editor', singleUse: true });

    const first = await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(g1.token));
    expect(first.status).toBe(200);
    expect(first.body.role).toBe('editor');
    expect((await request(app).get(`/api/invites/${body.invite.token}`).set(auth(g2.token))).status).toBe(404);
    expect((await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(g2.token))).status).toBe(404);
    // and it no longer shows up as a live link
    const list = await request(app).get(`/api/documents/${doc.id}/invites`).set(auth(owner.token));
    expect(list.body.invites).toHaveLength(0);
  });

  it('a single-use link is not spent when opening it changes nothing', async () => {
    const owner = await signup();
    const guest = await signup('Guest');
    const doc = await makeDoc(owner.token);
    const { body } = await invite(owner.token, doc.id, { role: 'viewer', singleUse: true });

    // the owner opening their own link must not burn it
    expect((await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(owner.token))).body.role).toBe('owner');
    const accepted = await request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(guest.token));
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe('viewer');
  });

  it('two people racing for one single-use link: exactly one gets in', async () => {
    const owner = await signup();
    const g1 = await signup('G1');
    const g2 = await signup('G2');
    const doc = await makeDoc(owner.token);
    const { body } = await invite(owner.token, doc.id, { role: 'editor', singleUse: true });
    const results = await Promise.all(
      [g1, g2].map((g) => request(app).post(`/api/invites/${body.invite.token}/accept`).set(auth(g.token)))
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    const members = await request(app).get(`/api/documents/${doc.id}/members`).set(auth(owner.token));
    expect(members.body.members).toHaveLength(2); // owner + the winner
  });

  it('caps live links per document, and expired ones do not count', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    for (let i = 0; i < MAX_ACTIVE_INVITES; i++) expect((await invite(owner.token, doc.id)).status).toBe(201);
    const over = await invite(owner.token, doc.id);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/too many/i);

    await query("UPDATE document_invites SET expires_at = now() - interval '1 minute' WHERE document_id = $1", [doc.id]);
    expect((await invite(owner.token, doc.id)).status).toBe(201);
    const list = await request(app).get(`/api/documents/${doc.id}/invites`).set(auth(owner.token));
    expect(list.body.invites).toHaveLength(1);
  });

  it('validates the singleUse flag', async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    expect((await invite(owner.token, doc.id, { role: 'editor', singleUse: 'yes' })).status).toBe(400);
  });
});

describe('version history pruning', () => {
  it(`keeps only the newest ${MAX_VERSIONS} versions per document`, async () => {
    const owner = await signup();
    const doc = await makeDoc(owner.token);
    const other = await makeDoc(owner.token, 'notes', 'Other');
    const total = MAX_VERSIONS + 5;
    await insertVersion(other.id, owner.user.id, 'other-doc', new Uint8Array([1]));
    for (let i = 0; i < total; i++) await insertVersion(doc.id, owner.user.id, `v${i}`, new Uint8Array([1, 2, 3]));

    const list = await request(app).get(`/api/documents/${doc.id}/versions`).set(auth(owner.token));
    const labels: string[] = list.body.versions.map((v: { label: string }) => v.label);
    expect(labels).toHaveLength(MAX_VERSIONS);
    expect(labels).toContain(`v${total - 1}`);
    expect(labels).not.toContain('v0');
    expect(labels).not.toContain('v4');
    expect(labels).toContain('v5');

    // pruning is per document: the other document's single version is untouched
    const otherList = await request(app).get(`/api/documents/${other.id}/versions`).set(auth(owner.token));
    expect(otherList.body.versions).toHaveLength(1);
  });
});

describe('awareness spoofing', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const awarenessMessage = (entries: { id: number; clock: number; state: unknown }[]) => {
    const update = encoding.createEncoder();
    encoding.writeVarUint(update, entries.length);
    for (const e of entries) {
      encoding.writeVarUint(update, e.id);
      encoding.writeVarUint(update, e.clock);
      encoding.writeVarString(update, JSON.stringify(e.state));
    }
    const msg = encoding.createEncoder();
    encoding.writeVarUint(msg, 1); // MESSAGE_AWARENESS
    encoding.writeVarUint8Array(msg, encoding.toUint8Array(update));
    return encoding.toUint8Array(msg);
  };

  async function rawClient(token: string, docId: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/${docId}?ticket=${await getTicket(token, docId)}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    return ws;
  }

  it("ignores updates that claim another connection's client id, and caps ids per connection", async () => {
    const owner = await signup('Owner');
    const guest = await signup('Guest');
    const doc = await makeDoc(owner.token);
    const inv = await invite(owner.token, doc.id);
    await request(app).post(`/api/invites/${inv.body.invite.token}/accept`).set(auth(guest.token));

    const a = await rawClient(owner.token, doc.id);
    const b = await rawClient(guest.token, doc.id);
    const room = () => getRoom(doc.id)!;
    const stateOf = (id: number) => room().awareness.getStates().get(id) as { user?: { name: string } } | undefined;

    // A announces itself with a real awareness update
    const awA = new awarenessProtocol.Awareness(new Y.Doc());
    awA.setLocalState({ user: { name: 'A' } });
    const idA = awA.doc.clientID;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awA, [idA]));
    a.send(encoding.toUint8Array(enc));
    await waitFor(() => stateOf(idA)?.user?.name === 'A');

    // B tries to overwrite A's presence with a newer clock, then to claim a pile of ids
    b.send(awarenessMessage([{ id: idA, clock: 9999, state: { user: { name: 'Evil' } } }]));
    b.send(awarenessMessage([1001, 1002, 1003, 1004, 1005].map((id) => ({ id, clock: 1, state: { user: { name: 'X' } } }))));
    // ...and then does something legitimate, which also proves the earlier messages were processed in order
    const idB = 424242;
    b.send(awarenessMessage([{ id: idB, clock: 1, state: { user: { name: 'B' } } }]));
    await waitFor(() => stateOf(idB)?.user?.name === 'B');

    expect(stateOf(idA)?.user?.name).toBe('A');
    expect([1001, 1002, 1003, 1004, 1005].some((id) => stateOf(id))).toBe(false);
    expect(b.readyState).toBe(WebSocket.OPEN); // dropped quietly, the connection survives

    a.close();
    b.close();
  });
});

describe('repo hygiene', () => {
  it('.dockerignore keeps env files (at any depth) out of the build context', () => {
    const lines = fs
      .readFileSync(path.resolve(__dirname, '../../.dockerignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    expect(lines).toContain('**/.env');
    expect(lines).toContain('**/.env.*');
    expect(lines).toContain('!**/.env.example');
  });
});

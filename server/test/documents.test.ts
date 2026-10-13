import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, auth, makeDoc, shareWith, signup } from './helpers.js';

describe('documents & permissions', () => {
  it('creates, lists, renames and deletes documents as owner', async () => {
    const { token } = await signup();
    const doc = await makeDoc(token, 'tasks', 'Sprint');
    const list = await request(app).get('/api/documents').set(auth(token));
    expect(list.body.documents.map((d: { id: string }) => d.id)).toContain(doc.id);

    const renamed = await request(app).patch(`/api/documents/${doc.id}`).set(auth(token)).send({ title: 'Sprint 2' });
    expect(renamed.body.document.title).toBe('Sprint 2');

    expect((await request(app).delete(`/api/documents/${doc.id}`).set(auth(token))).status).toBe(204);
    expect((await request(app).get(`/api/documents/${doc.id}`).set(auth(token))).status).toBe(404);
  });

  it('validates input', async () => {
    const { token } = await signup();
    const badType = await request(app).post('/api/documents').set(auth(token)).send({ title: 'x', type: 'video' });
    expect(badType.status).toBe(400);
    const empty = await request(app).post('/api/documents').set(auth(token)).send({ title: '   ', type: 'notes' });
    expect(empty.status).toBe(400);
  });

  it('does not let strangers read, rename, delete or even detect a document', async () => {
    const owner = await signup();
    const stranger = await signup();
    const doc = await makeDoc(owner.token);
    expect((await request(app).get(`/api/documents/${doc.id}`).set(auth(stranger.token))).status).toBe(404);
    expect(
      (await request(app).patch(`/api/documents/${doc.id}`).set(auth(stranger.token)).send({ title: 'pwn' })).status
    ).toBe(404);
    expect((await request(app).delete(`/api/documents/${doc.id}`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).post(`/api/documents/${doc.id}/ws-ticket`).set(auth(stranger.token))).status).toBe(404);
    const list = await request(app).get('/api/documents').set(auth(stranger.token));
    expect(list.body.documents).toHaveLength(0);
  });

  it('enforces viewer < editor < owner', async () => {
    const owner = await signup('Owner');
    const editor = await signup('Editor');
    const viewer = await signup('Viewer');
    const doc = await makeDoc(owner.token);
    await shareWith(owner.token, doc.id, editor.token, 'editor');
    await shareWith(owner.token, doc.id, viewer.token, 'viewer');

    const rename = (t: string) => request(app).patch(`/api/documents/${doc.id}`).set(auth(t)).send({ title: 'New' });
    expect((await rename(viewer.token)).status).toBe(403);
    expect((await rename(editor.token)).status).toBe(200);

    expect((await request(app).delete(`/api/documents/${doc.id}`).set(auth(editor.token))).status).toBe(403);
    const invite = (t: string) => request(app).post(`/api/documents/${doc.id}/invites`).set(auth(t)).send({ role: 'editor' });
    expect((await invite(editor.token)).status).toBe(403);
    expect((await invite(owner.token)).status).toBe(201);

    const version = (t: string) => request(app).post(`/api/documents/${doc.id}/versions`).set(auth(t)).send({});
    expect((await version(viewer.token)).status).toBe(403);
    expect((await version(editor.token)).status).toBe(201);
    // viewers may still read history
    expect((await request(app).get(`/api/documents/${doc.id}/versions`).set(auth(viewer.token))).status).toBe(200);
  });
});

describe('invites & members', () => {
  it('accepting an invite grants the role but never downgrades', async () => {
    const owner = await signup();
    const guest = await signup('Guest');
    const doc = await makeDoc(owner.token);

    const editorInvite = await request(app).post(`/api/documents/${doc.id}/invites`).set(auth(owner.token)).send({ role: 'editor' });
    const viewerInvite = await request(app).post(`/api/documents/${doc.id}/invites`).set(auth(owner.token)).send({ role: 'viewer' });

    const preview = await request(app).get(`/api/invites/${editorInvite.body.invite.token}`).set(auth(guest.token));
    expect(preview.body.invite.title).toBe('Doc');

    const accept = await request(app).post(`/api/invites/${editorInvite.body.invite.token}/accept`).set(auth(guest.token));
    expect(accept.body.role).toBe('editor');
    const again = await request(app).post(`/api/invites/${viewerInvite.body.invite.token}/accept`).set(auth(guest.token));
    expect(again.body.role).toBe('editor');

    // the owner stays owner even when opening an invite to their own document
    const self = await request(app).post(`/api/invites/${viewerInvite.body.invite.token}/accept`).set(auth(owner.token));
    expect(self.body.role).toBe('owner');
  });

  it('rejects unknown invite tokens', async () => {
    const { token } = await signup();
    expect((await request(app).get('/api/invites/not-a-real-token').set(auth(token))).status).toBe(404);
  });

  it('lets the owner change roles and remove members, and members leave', async () => {
    const owner = await signup('Owner');
    const guest = await signup('Guest');
    const doc = await makeDoc(owner.token);
    await shareWith(owner.token, doc.id, guest.token, 'viewer');

    const promote = await request(app)
      .patch(`/api/documents/${doc.id}/members/${guest.user.id}`)
      .set(auth(owner.token))
      .send({ role: 'editor' });
    expect(promote.body.members.find((m: { id: string }) => m.id === guest.user.id).role).toBe('editor');

    // a guest cannot change roles or remove the owner
    expect(
      (await request(app).patch(`/api/documents/${doc.id}/members/${guest.user.id}`).set(auth(guest.token)).send({ role: 'viewer' })).status
    ).toBe(403);
    expect((await request(app).delete(`/api/documents/${doc.id}/members/${owner.user.id}`).set(auth(guest.token))).status).toBe(403);
    // the owner can never be removed or demoted
    expect((await request(app).delete(`/api/documents/${doc.id}/members/${owner.user.id}`).set(auth(owner.token))).status).toBe(400);

    expect((await request(app).delete(`/api/documents/${doc.id}/members/${guest.user.id}`).set(auth(guest.token))).status).toBe(204);
    expect((await request(app).get(`/api/documents/${doc.id}`).set(auth(guest.token))).status).toBe(404);
  });
});

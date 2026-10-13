import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, signWsTicket } from '../auth.js';
import * as docs from '../documents.js';
import { asyncHandler, HttpError, idParam, parse } from '../http.js';
import { applyMembershipChange, closeRoom, getLiveState, restoreSnapshot } from '../collab/rooms.js';
import { makeBroadcast } from '../collab/protocol.js';

const title = z.string().trim().min(1, 'Title is required').max(120);
const createSchema = z.object({
  title: title.default('Untitled'),
  type: z.enum(['notes', 'whiteboard', 'tasks']),
});
const renameSchema = z.object({ title });
const roleSchema = z.object({ role: z.enum(['editor', 'viewer']) });
const inviteSchema = z.object({ role: z.enum(['editor', 'viewer']), singleUse: z.boolean().default(false) });
const versionSchema = z.object({ label: z.string().trim().max(80).optional() });

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const docId = (p: string | undefined) => parse(idParam, p);

documentsRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ documents: await docs.listDocuments(req.user!.id) });
}));

documentsRouter.post('/', asyncHandler(async (req, res) => {
  const { title, type } = parse(createSchema, req.body);
  res.status(201).json({ document: await docs.createDocument(req.user!.id, title, type) });
}));

documentsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  const role = await docs.requireRole(req.user!.id, id);
  res.json({ document: { ...(await docs.getDocument(id))!, role } });
}));

documentsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'editor');
  await docs.renameDocument(id, parse(renameSchema, req.body).title);
  res.json({ document: await docs.getDocument(id) });
}));

documentsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'owner');
  closeRoom(id, 4404, 'Document deleted');
  await docs.deleteDocument(id);
  res.status(204).end();
}));

/** Short-lived ticket for opening the WebSocket; also the access check clients use before connecting. */
documentsRouter.post('/:id/ws-ticket', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  const role = await docs.requireRole(req.user!.id, id);
  res.json({ ticket: signWsTicket(req.user!.id, id), role });
}));

// ---------- members & sharing ----------

documentsRouter.get('/:id/members', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id);
  res.json({ members: await docs.listMembers(id) });
}));

documentsRouter.patch('/:id/members/:userId', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'owner');
  const { role } = parse(roleSchema, req.body);
  const userId = docId(req.params.userId);
  await docs.setMemberRole(id, userId, role);
  applyMembershipChange(id, userId, role);
  res.json({ members: await docs.listMembers(id) });
}));

documentsRouter.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  const userId = docId(req.params.userId);
  // owners can remove anyone; members can remove themselves (leave)
  await docs.requireRole(req.user!.id, id, userId === req.user!.id ? 'viewer' : 'owner');
  await docs.removeMember(id, userId);
  applyMembershipChange(id, userId, null);
  res.status(204).end();
}));

documentsRouter.post('/:id/invites', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'owner');
  const { role, singleUse } = parse(inviteSchema, req.body);
  res.status(201).json({ invite: await docs.createInvite(id, req.user!.id, role, singleUse) });
}));

documentsRouter.get('/:id/invites', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'owner');
  res.json({ invites: await docs.listInvites(id) });
}));

documentsRouter.delete('/:id/invites/:inviteId', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'owner');
  await docs.revokeInvite(id, docId(req.params.inviteId));
  res.status(204).end();
}));

// ---------- version history ----------

documentsRouter.get('/:id/versions', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id);
  res.json({ versions: await docs.listVersions(id) });
}));

documentsRouter.post('/:id/versions', asyncHandler(async (req, res) => {
  const id = docId(req.params.id);
  await docs.requireRole(req.user!.id, id, 'editor');
  const { label } = parse(versionSchema, req.body ?? {});
  const versionId = await docs.insertVersion(id, req.user!.id, label || 'Saved version', await getLiveState(id));
  res.status(201).json({ version: { id: versionId } });
}));

documentsRouter.post(
  '/:id/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    const id = docId(req.params.id);
    await docs.requireRole(req.user!.id, id, 'editor');
    const doc = await docs.getDocument(id);
    if (!doc) throw new HttpError(404, 'Document not found');
    const snapshot = await docs.getVersionState(id, docId(req.params.versionId));
    // Safety net: keep the pre-restore state so a restore can itself be undone.
    await docs.insertVersion(id, req.user!.id, 'Before restore', await getLiveState(id));
    await restoreSnapshot(id, doc.type, snapshot, makeBroadcast);
    res.json({ ok: true });
  })
);


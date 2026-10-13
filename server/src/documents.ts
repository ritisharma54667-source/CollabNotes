import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { many, one, query, withTransaction, type DocType, type Role } from './db.js';
import { HttpError } from './http.js';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };
export const canEdit = (role: Role) => RANK[role] >= RANK.editor;

export interface DocumentMeta {
  id: string;
  title: string;
  type: DocType;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

export async function getRole(userId: string, documentId: string): Promise<Role | null> {
  const row = await one<{ role: Role }>('SELECT role FROM document_members WHERE document_id = $1 AND user_id = $2', [
    documentId,
    userId,
  ]);
  return row?.role ?? null;
}

/** Throws 404 when the user is not a member (we never reveal that a document exists). */
export async function requireRole(userId: string, documentId: string, min: Role = 'viewer'): Promise<Role> {
  const role = await getRole(userId, documentId);
  if (!role) throw new HttpError(404, 'Document not found');
  if (RANK[role] < RANK[min]) throw new HttpError(403, 'You do not have permission to do that');
  return role;
}

export async function createDocument(ownerId: string, title: string, type: DocType): Promise<DocumentMeta> {
  const id = uuid();
  await withTransaction(async (c) => {
    await c.query('INSERT INTO documents (id, title, type, owner_id) VALUES ($1, $2, $3, $4)', [id, title, type, ownerId]);
    await c.query("INSERT INTO document_members (document_id, user_id, role) VALUES ($1, $2, 'owner')", [id, ownerId]);
  });
  return (await getDocument(id))!;
}

export function getDocument(id: string) {
  return one<DocumentMeta>('SELECT id, title, type, owner_id, created_at, updated_at FROM documents WHERE id = $1', [id]);
}

export function listDocuments(userId: string) {
  return many(
    `SELECT d.id, d.title, d.type, d.owner_id, d.created_at, d.updated_at, m.role
     FROM documents d JOIN document_members m ON m.document_id = d.id
     WHERE m.user_id = $1 ORDER BY d.updated_at DESC`,
    [userId]
  );
}

export async function renameDocument(id: string, title: string) {
  await query('UPDATE documents SET title = $1, updated_at = now() WHERE id = $2', [title, id]);
}

export async function deleteDocument(id: string) {
  await query('DELETE FROM documents WHERE id = $1', [id]);
}

export async function loadYjsState(id: string): Promise<Uint8Array | null> {
  const row = await one<{ yjs_state: Buffer | null }>('SELECT yjs_state FROM documents WHERE id = $1', [id]);
  return row?.yjs_state ? new Uint8Array(row.yjs_state) : null;
}

export async function saveYjsState(id: string, state: Uint8Array) {
  await query('UPDATE documents SET yjs_state = $1, updated_at = now() WHERE id = $2', [Buffer.from(state), id]);
}

// ---------- members ----------

export function listMembers(documentId: string) {
  return many(
    `SELECT u.id, u.name, u.email, m.role FROM document_members m
     JOIN users u ON u.id = m.user_id WHERE m.document_id = $1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
    [documentId]
  );
}

export async function setMemberRole(documentId: string, userId: string, role: 'editor' | 'viewer') {
  const current = await getRole(userId, documentId);
  if (!current) throw new HttpError(404, 'Member not found');
  if (current === 'owner') throw new HttpError(400, "The owner's role cannot be changed");
  await query('UPDATE document_members SET role = $1 WHERE document_id = $2 AND user_id = $3', [role, documentId, userId]);
}

export async function removeMember(documentId: string, userId: string) {
  const current = await getRole(userId, documentId);
  if (!current) throw new HttpError(404, 'Member not found');
  if (current === 'owner') throw new HttpError(400, 'The owner cannot be removed');
  await query('DELETE FROM document_members WHERE document_id = $1 AND user_id = $2', [documentId, userId]);
}

// ---------- invites ----------

const INVITE_TTL_DAYS = 7;
/** Upper bound of live (unexpired, unused) links per document, so the table cannot grow without limit. */
export const MAX_ACTIVE_INVITES = 25;
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function createInvite(documentId: string, createdBy: string, role: 'editor' | 'viewer', singleUse = false) {
  // Housekeeping: expired and already-used links are dead weight.
  await query('DELETE FROM document_invites WHERE document_id = $1 AND (expires_at <= now() OR used_at IS NOT NULL)', [documentId]);
  const active = await one<{ n: string }>('SELECT count(*) AS n FROM document_invites WHERE document_id = $1', [documentId]);
  if (Number(active?.n ?? 0) >= MAX_ACTIVE_INVITES) {
    throw new HttpError(400, `Too many active invite links (max ${MAX_ACTIVE_INVITES}). Revoke some first.`);
  }
  const id = uuid();
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await query(
    'INSERT INTO document_invites (id, document_id, token_hash, role, created_by, expires_at, single_use) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, documentId, hashToken(token), role, createdBy, expiresAt, singleUse]
  );
  return { id, token, role, singleUse, expiresAt: expiresAt.toISOString() };
}

/** Live links of a document. The token itself is never stored (only its hash), so it cannot be listed. */
export function listInvites(documentId: string) {
  return many(
    `SELECT i.id, i.role, i.single_use AS "singleUse", i.expires_at AS "expiresAt", i.created_at AS "createdAt", u.name AS "createdBy"
     FROM document_invites i JOIN users u ON u.id = i.created_by
     WHERE i.document_id = $1 AND i.expires_at > now() AND i.used_at IS NULL
     ORDER BY i.created_at DESC`,
    [documentId]
  );
}

export async function revokeInvite(documentId: string, inviteId: string) {
  const res = await query('DELETE FROM document_invites WHERE id = $1 AND document_id = $2', [inviteId, documentId]);
  if (res.rowCount === 0) throw new HttpError(404, 'Invite not found');
}

async function findInvite(token: string) {
  const row = await one<{ document_id: string; role: 'editor' | 'viewer'; title: string; type: DocType }>(
    `SELECT i.document_id, i.role, d.title, d.type
     FROM document_invites i JOIN documents d ON d.id = i.document_id
     WHERE i.token_hash = $1 AND i.expires_at > now() AND i.used_at IS NULL`,
    [hashToken(token)]
  );
  if (!row) throw new HttpError(404, 'Invite link is invalid, expired or revoked');
  return row;
}

export async function previewInvite(token: string) {
  const i = await findInvite(token);
  return { documentId: i.document_id, title: i.title, type: i.type, role: i.role };
}

export async function acceptInvite(token: string, userId: string) {
  // One transaction, with the invite row locked: two people racing for a single-use link cannot both win,
  // and a revoke that lands first makes the accept fail instead of half-succeeding.
  const documentId = await withTransaction(async (c) => {
    const found = await c.query<{ id: string; document_id: string; role: 'editor' | 'viewer'; single_use: boolean }>(
      `SELECT id, document_id, role, single_use FROM document_invites
       WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL FOR UPDATE`,
      [hashToken(token)]
    );
    const invite = found.rows[0];
    if (!invite) throw new HttpError(404, 'Invite link is invalid, expired or revoked');

    // Insert-or-upgrade in one statement: a new member gets the invite's role, an existing viewer is
    // upgraded by an editor invite, and nobody is ever downgraded (or loses ownership).
    const res = await c.query(
      `INSERT INTO document_members (document_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = 'editor'
       WHERE document_members.role = 'viewer' AND EXCLUDED.role = 'editor'`,
      [invite.document_id, userId, invite.role]
    );
    // A single-use link is only spent when it actually changed something (an owner opening their own link keeps it).
    if (invite.single_use && res.rowCount) {
      await c.query('UPDATE document_invites SET used_at = now() WHERE id = $1', [invite.id]);
    }
    return invite.document_id;
  });
  return { documentId, role: (await getRole(userId, documentId))! };
}

// ---------- versions ----------

export function listVersions(documentId: string) {
  return many(
    `SELECT v.id, v.label, v.created_at, u.name AS author FROM document_versions v
     JOIN users u ON u.id = v.created_by WHERE v.document_id = $1
     ORDER BY v.created_at DESC, v.id DESC LIMIT 100`,
    [documentId]
  );
}

/** Newest versions kept per document; older ones are pruned whenever a new one is saved. */
export const MAX_VERSIONS = 50;

export async function insertVersion(documentId: string, userId: string, label: string, state: Uint8Array) {
  const id = uuid();
  await withTransaction(async (c) => {
    await c.query('INSERT INTO document_versions (id, document_id, label, state, created_by) VALUES ($1, $2, $3, $4, $5)', [
      id,
      documentId,
      label,
      Buffer.from(state),
      userId,
    ]);
    // Same ordering as listVersions; the version just written is never a pruning candidate.
    await c.query(
      `DELETE FROM document_versions
       WHERE document_id = $1 AND id <> $2 AND id NOT IN (
         SELECT id FROM document_versions WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT $3
       )`,
      [documentId, id, MAX_VERSIONS]
    );
  });
  return id;
}

export async function getVersionState(documentId: string, versionId: string): Promise<Uint8Array> {
  const row = await one<{ state: Buffer }>('SELECT state FROM document_versions WHERE id = $1 AND document_id = $2', [
    versionId,
    documentId,
  ]);
  if (!row) throw new HttpError(404, 'Version not found');
  return new Uint8Array(row.state);
}

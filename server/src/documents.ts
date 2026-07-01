import { v4 as uuid } from 'uuid';
import { db, type Document } from './db.js';

export function createDocument(
  ownerId: string,
  title: string,
  type: Document['type'] = 'notes'
): Document {
  const id = uuid();
  db.prepare(
    'INSERT INTO documents (id, title, type, owner_id) VALUES (?, ?, ?, ?)'
  ).run(id, title, type, ownerId);
  db.prepare(
    'INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, ?)'
  ).run(id, ownerId, 'owner');
  return getDocument(id)!;
}

export function getDocument(id: string): Document | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | undefined;
}

export function listDocumentsForUser(userId: string) {
  return db
    .prepare(
      `SELECT d.*, u.name as owner_name
       FROM documents d
       JOIN document_members dm ON d.id = dm.document_id
       JOIN users u ON d.owner_id = u.id
       WHERE dm.user_id = ?
       ORDER BY d.updated_at DESC`
    )
    .all(userId);
}

export function saveYjsState(documentId: string, state: Uint8Array) {
  db.prepare('UPDATE documents SET yjs_state = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    Buffer.from(state),
    documentId
  );
}

export function loadYjsState(documentId: string): Uint8Array | null {
  const row = db.prepare('SELECT yjs_state FROM documents WHERE id = ?').get(documentId) as
    | { yjs_state: Buffer | null }
    | undefined;
  if (!row?.yjs_state) return null;
  return new Uint8Array(row.yjs_state);
}

export function joinDocument(documentId: string, userId: string) {
  const existing = db
    .prepare('SELECT 1 FROM document_members WHERE document_id = ? AND user_id = ?')
    .get(documentId, userId);
  if (existing) return;
  db.prepare('INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, ?)').run(
    documentId,
    userId,
    'editor'
  );
}

export function userCanAccessDocument(userId: string, documentId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM document_members WHERE document_id = ? AND user_id = ?')
    .get(documentId, userId);
  return !!row;
}

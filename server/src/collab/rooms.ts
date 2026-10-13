import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import { loadYjsState, saveYjsState } from '../documents.js';
import { logger } from '../logger.js';
import type { DocType, Role } from '../db.js';

export interface ClientInfo {
  userId: string;
  role: Role;
  awarenessIds: Set<number>;
}

export interface Room {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Map<WebSocket, ClientInfo>;
  dirty: boolean;
  saveTimer: NodeJS.Timeout | null;
  /** Serialises writes so an older snapshot can never overwrite a newer one. */
  saving: Promise<void>;
  /** Sends a message to every client except `except`. Wired up by the protocol layer. */
  broadcast: (data: Uint8Array, except?: WebSocket) => void;
}

type MakeBroadcast = (room: Room) => Room['broadcast'];

const PERSIST_DEBOUNCE_MS = 2000;
const rooms = new Map<string, Room>();
/** Rooms that are still loading from the database — concurrent joiners share one load. */
const loading = new Map<string, Promise<Room>>();

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export async function getOrCreateRoom(id: string, makeBroadcast: MakeBroadcast): Promise<Room> {
  const existing = rooms.get(id);
  if (existing) return existing;
  const pending = loading.get(id);
  if (pending) return pending;

  const promise = (async () => {
    const doc = new Y.Doc();
    const state = await loadYjsState(id);
    if (state) Y.applyUpdate(doc, state);

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server itself is not a participant

    const room: Room = {
      id,
      doc,
      awareness,
      clients: new Map(),
      dirty: false,
      saveTimer: null,
      saving: Promise.resolve(),
      broadcast: () => {},
    };
    room.broadcast = makeBroadcast(room);
    rooms.set(id, room);
    return room;
  })();

  loading.set(id, promise);
  try {
    return await promise;
  } finally {
    loading.delete(id);
  }
}

export function markDirty(room: Room) {
  room.dirty = true;
  if (room.saveTimer) return; // debounce: at most one write per interval, even during continuous editing
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    void persistRoom(room);
  }, PERSIST_DEBOUNCE_MS);
}

/** Writes the room to the database if it changed. Resolves once the write has finished. */
export function persistRoom(room: Room): Promise<void> {
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  room.saving = room.saving.then(async () => {
    if (!room.dirty) return;
    room.dirty = false; // anything edited while the write is in flight marks it dirty again
    try {
      await saveYjsState(room.id, Y.encodeStateAsUpdate(room.doc));
    } catch (err) {
      room.dirty = true;
      logger.error('Failed to persist document', { documentId: room.id, error: String(err) });
      markDirty(room); // retry later
    }
  });
  return room.saving;
}

export async function destroyRoomIfEmpty(room: Room) {
  if (room.clients.size > 0) return;
  await persistRoom(room);
  // someone may have joined while we were writing
  if (room.clients.size > 0 || rooms.get(room.id) !== room) return;
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.awareness.destroy();
  room.doc.destroy();
  rooms.delete(room.id);
}

/** Current document state, from the live room when one exists, otherwise from the database. */
export async function getLiveState(id: string): Promise<Uint8Array> {
  const room = rooms.get(id);
  if (room) return Y.encodeStateAsUpdate(room.doc);
  return (await loadYjsState(id)) ?? Y.encodeStateAsUpdate(new Y.Doc());
}

/** Close every connection of a document (e.g. it was deleted). */
export function closeRoom(id: string, code: number, reason: string) {
  const room = rooms.get(id);
  if (!room) return;
  room.dirty = false;
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  for (const ws of room.clients.keys()) ws.close(code, reason);
}

/** Apply a changed role (or removal) to a user's live connections. */
export function applyMembershipChange(id: string, userId: string, role: Role | null) {
  const room = rooms.get(id);
  if (!room) return;
  for (const [ws, info] of room.clients) {
    if (info.userId !== userId) continue;
    if (role === null) ws.close(4403, 'Access revoked');
    else info.role = role;
  }
}

export async function flushAllRooms() {
  await Promise.all(Array.from(rooms.values(), (room) => persistRoom(room)));
}

/**
 * Replace a live document's content with a snapshot. Runs as a normal Yjs transaction, so every
 * connected client receives it as a regular update (and it stays a CRDT-safe, undoable operation).
 */
export async function restoreSnapshot(id: string, type: DocType, snapshot: Uint8Array, makeBroadcast: MakeBroadcast) {
  const room = await getOrCreateRoom(id, makeBroadcast);
  try {
    const snap = new Y.Doc();
    Y.applyUpdate(snap, snapshot);
    room.doc.transact(() => {
      if (type === 'notes') {
        const live = room.doc.getXmlFragment('content');
        const src = snap.getXmlFragment('content');
        live.delete(0, live.length);
        live.insert(0, src.toArray().map((n) => n.clone() as Y.XmlElement | Y.XmlText));
      } else if (type === 'whiteboard') {
        const live = room.doc.getArray<unknown>('strokes');
        const src = snap.getArray<unknown>('strokes');
        live.delete(0, live.length);
        live.insert(0, src.toArray());
      } else {
        const live = room.doc.getArray<Y.Map<unknown>>('tasks');
        const src = snap.getArray<Y.Map<unknown>>('tasks');
        live.delete(0, live.length);
        live.insert(0, src.toArray().map((m) => m.clone()));
      }
    }, 'restore');
    snap.destroy();
    await persistRoom(room);
  } finally {
    await destroyRoomIfEmpty(room);
  }
}

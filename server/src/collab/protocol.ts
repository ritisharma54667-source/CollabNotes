import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import {
  destroyRoomIfEmpty,
  markDirty,
  type ClientInfo,
  type Room,
} from './rooms.js';
import type { Role } from '../db.js';
import { canEdit } from '../documents.js';
import { logger } from '../logger.js';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

const MAX_MESSAGES_PER_SECOND = 300;
/** A browser tab uses exactly one awareness id; a little headroom, but no unbounded growth per connection. */
const MAX_AWARENESS_IDS_PER_CLIENT = 4;

const send = (ws: WebSocket, data: Uint8Array) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(data, (err) => err && ws.terminate());
};

/** Wires a room's Yjs/awareness events to its connected clients. Called once per room. */
export function makeBroadcast(room: Room): Room['broadcast'] {
  const broadcast: Room['broadcast'] = (data, except) => {
    for (const ws of room.clients.keys()) if (ws !== except) send(ws, data);
  };

  room.doc.on('update', (update: Uint8Array, origin: unknown) => {
    markDirty(room);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    // Only the incremental update is sent, and never echoed back to the client it came from.
    broadcast(encoding.toUint8Array(enc), origin instanceof WebSocket ? origin : undefined);
  });

  room.awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin instanceof WebSocket) {
        const info = room.clients.get(origin);
        if (info) {
          added.forEach((id) => info.awarenessIds.add(id));
          removed.forEach((id) => info.awarenessIds.delete(id));
        }
      }
      const changed = added.concat(updated, removed);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed));
      broadcast(encoding.toUint8Array(enc), origin instanceof WebSocket ? origin : undefined);
    }
  );

  return broadcast;
}

/** Client ids an awareness update speaks for (the wire format is: count, then [clientId, clock, state] per entry). */
export function awarenessUpdateClientIds(update: Uint8Array): number[] {
  const d = decoding.createDecoder(update);
  const len = decoding.readVarUint(d);
  const ids: number[] = [];
  for (let i = 0; i < len; i++) {
    ids.push(decoding.readVarUint(d));
    decoding.readVarUint(d); // clock
    decoding.readVarString(d); // state (JSON)
  }
  return ids;
}

/**
 * A client may only speak for its own awareness ids: ones already owned by another connection are refused
 * (no cursor/presence spoofing), and so is a connection claiming more than a handful of ids.
 */
function mayApplyAwareness(room: Room, ws: WebSocket, info: ClientInfo, update: Uint8Array): boolean {
  const ids = awarenessUpdateClientIds(update);
  const owned = new Set(info.awarenessIds);
  for (const id of ids) {
    for (const [other, otherInfo] of room.clients) {
      if (other !== ws && otherInfo.awarenessIds.has(id)) return false;
    }
    owned.add(id);
  }
  return owned.size <= MAX_AWARENESS_IDS_PER_CLIENT;
}

/**
 * Handles one client message. Throws on malformed input — the caller closes the socket.
 * Viewers may only *read* (sync step 1); their document updates are dropped.
 */
export function handleMessage(room: Room, ws: WebSocket, info: ClientInfo, data: Uint8Array) {
  const decoder = decoding.createDecoder(data);
  const type = decoding.readVarUint(decoder);

  if (type === MESSAGE_SYNC) {
    const syncType = decoding.readVarUint(decoding.clone(decoder));
    if (!canEdit(info.role) && syncType !== syncProtocol.messageYjsSyncStep1) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, enc, room.doc, ws);
    if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc));
  } else if (type === MESSAGE_AWARENESS) {
    const update = decoding.readVarUint8Array(decoder);
    if (!mayApplyAwareness(room, ws, info, update)) return; // dropped, not fatal: it may just be a stale id
    awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
  }
}

/** Registers a freshly upgraded socket with its (already loaded) room. Synchronous, so no message can be missed. */
export function joinRoom(room: Room, ws: WebSocket, user: { userId: string; role: Role }) {
  const documentId = room.id;
  const info: ClientInfo = { userId: user.userId, role: user.role, awarenessIds: new Set() };
  room.clients.set(ws, info);

  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  let windowStart = Date.now();
  let count = 0;

  ws.on('message', (raw: Buffer) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > MAX_MESSAGES_PER_SECOND) return ws.close(1008, 'Rate limit exceeded');
    try {
      handleMessage(room, ws, info, new Uint8Array(raw));
    } catch (err) {
      logger.warn('Closing connection after malformed message', { documentId, error: String(err) });
      ws.close(1003, 'Malformed message');
    }
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    room.clients.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(info.awarenessIds), null);
    void destroyRoomIfEmpty(room);
  };
  ws.on('close', cleanup);
  ws.on('error', () => ws.terminate());

  // Initial handshake: ask the client for its state and give it ours.
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, room.doc);
  send(ws, encoding.toUint8Array(enc));

  const states = room.awareness.getStates();
  if (states.size > 0) {
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())));
    send(ws, encoding.toUint8Array(aw));
  }
}


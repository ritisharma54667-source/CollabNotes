/**
 * Yjs WebSocket sync server with JWT auth and SQLite persistence.
 *
 * Conflict handling: Yjs uses CRDTs (Conflict-free Replicated Data Types).
 * When two users edit simultaneously, Yjs merges changes automatically —
 * no "last write wins" data loss. Each edit carries a unique client ID +
 * clock, so concurrent inserts at the same position both survive in order.
 */
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { verifyToken } from './auth.js';
import { loadYjsState, saveYjsState, userCanAccessDocument } from './documents.js';

const messageSync = 0;
const messageAwareness = 1;

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
  persistTimer: ReturnType<typeof setInterval> | null;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(documentId: string): Room {
  let room = rooms.get(documentId);
  if (room) return room;

  const doc = new Y.Doc();
  const saved = loadYjsState(documentId);
  if (saved) {
    Y.applyUpdate(doc, saved);
  }

  const awareness = new awarenessProtocol.Awareness(doc);
  room = { doc, awareness, clients: new Set(), persistTimer: null };

  // Persist document state every 5 seconds when active
  room.persistTimer = setInterval(() => {
    if (room!.clients.size > 0) {
      const state = Y.encodeStateAsUpdate(room!.doc);
      saveYjsState(documentId, state);
    }
  }, 5000);

  doc.on('update', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    const message = encoding.toUint8Array(encoder);
    room!.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    );
    const message = encoding.toUint8Array(encoder);
    room!.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  rooms.set(documentId, room);
  return room;
}

function destroyRoomIfEmpty(documentId: string) {
  const room = rooms.get(documentId);
  if (!room || room.clients.size > 0) return;

  if (room.persistTimer) clearInterval(room.persistTimer);
  const state = Y.encodeStateAsUpdate(room.doc);
  saveYjsState(documentId, state);
  room.awareness.destroy();
  room.doc.destroy();
  rooms.delete(documentId);
}

function sendSyncStep1(ws: WebSocket, doc: Y.Doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  ws.send(encoding.toUint8Array(encoder));
}

export function setupWebSocketServer(port: number) {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${port}`);
    const token = url.searchParams.get('token');
    const documentId = url.pathname.slice(1); // /doc-id

    if (!token || !documentId) {
      ws.close(4001, 'Missing token or document ID');
      return;
    }

    let userId: string;
    let userName: string;
    try {
      const payload = verifyToken(token);
      userId = payload.userId;
      userName = payload.name;
    } catch {
      ws.close(4003, 'Invalid token');
      return;
    }

    if (!userCanAccessDocument(userId, documentId)) {
      ws.close(4003, 'Access denied');
      return;
    }

    const room = getOrCreateRoom(documentId);
    room.clients.add(ws);

    // Send initial sync + awareness
    sendSyncStep1(ws, room.doc);
    {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [room.doc.clientID])
      );
      ws.send(encoding.toUint8Array(encoder));
    }

    const clientIds = new Set<number>();
    const trackAwareness = (awareness: awarenessProtocol.Awareness, update: Uint8Array, origin: unknown) => {
      const before = new Set(awareness.getStates().keys());
      awarenessProtocol.applyAwarenessUpdate(awareness, update, origin);
      awareness.getStates().forEach((_, id) => {
        if (!before.has(id)) clientIds.add(id);
      });
    };

    ws.on('message', (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
          break;
        }
        case messageAwareness: {
          trackAwareness(room.awareness, decoding.readVarUint8Array(decoder), ws);
          break;
        }
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      if (clientIds.size > 0) {
        awarenessProtocol.removeAwarenessStates(room.awareness, [...clientIds], ws);
      }
      destroyRoomIfEmpty(documentId);
    });

    ws.on('error', () => {
      room.clients.delete(ws);
      destroyRoomIfEmpty(documentId);
    });

    console.log(`[WS] ${userName} joined document ${documentId.slice(0, 8)}…`);
  });

  console.log(`WebSocket server listening on ws://localhost:${port}`);
  return wss;
}

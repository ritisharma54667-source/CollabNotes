import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { verifyWsTicket } from '../auth.js';
import { getRole } from '../documents.js';
import { joinRoom, makeBroadcast } from './protocol.js';
import { destroyRoomIfEmpty, getOrCreateRoom } from './rooms.js';
import { logger } from '../logger.js';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (tests, CLIs) don't send Origin
  try {
    const url = new URL(origin);
    if (host && url.host === host) return true; // same-origin deployment
  } catch {
    return false;
  }
  return config.corsOrigins.includes(origin);
}

/** Attaches the collaboration endpoint (`/ws/:documentId?ticket=…`) to an existing HTTP server. */
export function attachCollabServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void handleUpgrade(req, socket, head).catch((err) => {
      logger.error('WebSocket upgrade failed', { error: String(err) });
      reject(socket, 500, 'Internal Server Error');
    });
  });

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (!match) return reject(socket, 404, 'Not Found');
    const documentId = decodeURIComponent(match[1]);

    if (!isOriginAllowed(req.headers.origin, req.headers.host)) return reject(socket, 403, 'Forbidden');

    const ticket = url.searchParams.get('ticket');
    const user = ticket ? await verifyWsTicket(ticket, documentId) : null;
    if (!user) return reject(socket, 401, 'Unauthorized');

    // Role is read fresh from the database, so revoked access is honoured even with a valid ticket.
    const role = await getRole(user.id, documentId);
    if (!role) return reject(socket, 403, 'Forbidden');

    // Load the room *before* upgrading so the first client message can never arrive before we listen.
    const room = await getOrCreateRoom(documentId, makeBroadcast);
    if (socket.destroyed) return void destroyRoomIfEmpty(room);

    wss.handleUpgrade(req, socket, head, (ws) => joinRoom(room, ws, { userId: user.id, role }));
  }

  return wss;
}

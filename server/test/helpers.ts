import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { attachCollabServer } from '../src/collab/server.js';

export const app = createApp();

let counter = 0;
export async function signup(name = 'User') {
  const email = `user${Date.now()}${counter++}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ email, name, password: 'password123' });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string; name: string }, email };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function makeDoc(token: string, type: 'notes' | 'whiteboard' | 'tasks' = 'notes', title = 'Doc') {
  const res = await request(app).post('/api/documents').set(auth(token)).send({ title, type });
  return res.body.document as { id: string; title: string };
}

export async function shareWith(ownerToken: string, docId: string, guestToken: string, role: 'editor' | 'viewer') {
  const inv = await request(app).post(`/api/documents/${docId}/invites`).set(auth(ownerToken)).send({ role });
  await request(app).post(`/api/invites/${inv.body.invite.token}/accept`).set(auth(guestToken));
}

export async function startServer() {
  const server = http.createServer(app);
  const wss = attachCollabServer(server);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((c) => c.terminate());
        server.close(() => resolve());
      }),
  };
}

export async function getTicket(token: string, docId: string) {
  const res = await request(app).post(`/api/documents/${docId}/ws-ticket`).set(auth(token));
  return res.body.ticket as string;
}

/** Minimal Yjs sync client for tests. */
export class TestClient {
  doc = new Y.Doc();
  ws: WebSocket;
  synced = false;
  closeCode: number | null = null;

  constructor(port: number, docId: string, ticket: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${docId}?ticket=${ticket}`);
    this.ws.binaryType = 'nodebuffer';
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeUpdate(enc, update);
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encoding.toUint8Array(enc));
    });
    this.ws.on('message', (raw: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(raw));
      if (decoding.readVarUint(decoder) !== 0) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      const type = syncProtocol.readSyncMessage(decoder, enc, this.doc, this);
      if (type === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (encoding.length(enc) > 1) this.ws.send(encoding.toUint8Array(enc));
    });
    this.ws.on('close', (code) => (this.closeCode = code));
    this.ws.on('open', () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.ws.send(encoding.toUint8Array(enc));
    });
  }

  close() {
    this.ws.close();
  }
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeout = 3000) {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ApiError, type Role } from './api';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
  isSelf: boolean;
}

export interface CollabProviderOptions {
  documentId: string;
  /** Fetches a fresh short-lived ticket; called before every (re)connect. */
  getTicket: () => Promise<{ ticket: string; role: Role }>;
  user: { name: string; color: string };
  onStatus?: (status: ConnectionStatus) => void;
  onSynced?: (synced: boolean) => void;
  onPresence?: (users: PresenceUser[]) => void;
  onRole?: (role: Role) => void;
  /** Reconnecting is pointless (no access, deleted, …). */
  onFatal?: (message: string) => void;
  wsUrl?: (documentId: string, ticket: string) => string;
}

const defaultWsUrl = (id: string, ticket: string) => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`;
};

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private synced = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private fatal = false;
  private presenceSignature = '';

  constructor(
    doc: Y.Doc,
    private opts: CollabProviderOptions
  ) {
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.awareness.setLocalStateField('user', opts.user);

    // Registered ONCE for the lifetime of the provider (not per connection), so a reconnect
    // can never cause updates to be sent more than once.
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.awareness.on('change', this.emitPresence);
    window.addEventListener('online', this.onOnline);

    this.emitPresence();
    void this.connect();
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // came from the server
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.send(encoding.toUint8Array(enc));
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    this.send(encoding.toUint8Array(enc));
  };

  private emitPresence = () => {
    const users: PresenceUser[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      const u = (state as { user?: { name: string; color: string } }).user;
      if (u) users.push({ clientId, name: u.name, color: u.color, isSelf: clientId === this.doc.clientID });
    });
    users.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.clientId - b.clientId);
    // Presence changes on every cursor move; only notify React when the *set of people* changes.
    const sig = users.map((u) => `${u.clientId}:${u.name}:${u.color}`).join('|');
    if (sig === this.presenceSignature) return;
    this.presenceSignature = sig;
    this.opts.onPresence?.(users);
  };

  private onOnline = () => {
    if (this.status === 'disconnected' && !this.fatal) {
      this.attempts = 0;
      void this.connect();
    }
  };

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private setSynced(v: boolean) {
    if (this.synced === v) return;
    this.synced = v;
    this.opts.onSynced?.(v);
  }

  private send(data: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  async connect() {
    if (this.destroyed || this.fatal) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setStatus('connecting');

    let ticket: string;
    try {
      const res = await this.opts.getTicket();
      ticket = res.ticket;
      this.opts.onRole?.(res.role);
    } catch (err) {
      if (this.destroyed) return;
      if (err instanceof ApiError && [401, 403, 404].includes(err.status)) {
        this.fatal = true;
        this.setStatus('disconnected');
        this.opts.onFatal?.(err.status === 404 ? 'This document does not exist or you no longer have access.' : 'You do not have access to this document.');
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (this.destroyed) return;

    const ws = new WebSocket((this.opts.wsUrl ?? defaultWsUrl)(this.opts.documentId, ticket));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('connected');
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.send(encoding.toUint8Array(enc));
      if (this.awareness.getLocalState() !== null) {
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
        this.send(encoding.toUint8Array(aw));
      }
    };

    ws.onmessage = (event) => {
      try {
        this.handleMessage(new Uint8Array(event.data as ArrayBuffer));
      } catch (err) {
        console.error('Bad collaboration message', err);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return; // a stale socket
      this.ws = null;
      this.setSynced(false);
      this.setStatus('disconnected');
      // Remove other people's cursors; they are re-sent on reconnect.
      const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID);
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
      if (event.code === 4404 || event.code === 4403) {
        this.fatal = true;
        this.opts.onFatal?.(event.code === 4404 ? 'This document was deleted.' : 'Your access to this document was removed.');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleMessage(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const syncType = syncProtocol.readSyncMessage(decoder, enc, this.doc, this);
      if (syncType === syncProtocol.messageYjsSyncStep2) this.setSynced(true);
      if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private scheduleReconnect() {
    if (this.destroyed || this.fatal) return;
    this.setStatus('disconnected');
    // exponential backoff with jitter: ~1s, 2s, 4s … capped at 30s
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts++;
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.onOnline);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.off('change', this.emitPresence);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.awareness.destroy();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}

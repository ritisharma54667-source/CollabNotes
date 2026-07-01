/**
 * Custom Yjs WebSocket provider matching our server protocol.
 * Handles sync + awareness (cursor/presence) over a single WebSocket.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const messageSync = 0;
const messageAwareness = 1;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface CollabProviderOptions {
  documentId: string;
  token: string;
  wsUrl: string;
  user: { name: string; color: string };
  onStatusChange?: (status: ConnectionStatus) => void;
   onPeersChange?: (peers: Map<number, Record<string, unknown>>) => void;
}

export class CollabProvider {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  status: ConnectionStatus = 'connecting';
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private options: CollabProviderOptions) {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalStateField('user', options.user);
    this.awareness.on('change', () => {
      options.onPeersChange?.(this.awareness.getStates());
    });
    this.connect();
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private connect() {
    if (this.destroyed) return;
    this.setStatus('connecting');

    const url = `${this.options.wsUrl}/${this.options.documentId}?token=${encodeURIComponent(this.options.token)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => this.setStatus('connected');

    this.ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          if (encoding.length(encoder) > 1 && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(encoding.toUint8Array(encoder));
          }
          break;
        }
        case messageAwareness:
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this
          );
          break;
      }
    };

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      this.ws.send(encoding.toUint8Array(encoder));
    });

    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
      );
      this.ws.send(encoding.toUint8Array(encoder));
    });

    this.ws.onclose = () => {
      this.setStatus('disconnected');
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = () => this.ws?.close();
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.awareness.destroy();
    this.doc.destroy();
    this.ws?.close();
  }
}

export const USER_COLORS = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#22c55e',
];

export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

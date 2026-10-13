import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { CollabProvider, type CollabProviderOptions } from './collabProvider';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  receive(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
}

/** Counts sync "update" messages (type 0 / sync-type 2) among what a socket sent. */
const updatesSent = (ws: FakeWebSocket) =>
  ws.sent.filter((m) => {
    const d = decoding.createDecoder(m);
    return decoding.readVarUint(d) === 0 && decoding.readVarUint(d) === syncProtocol.messageYjsUpdate;
  }).length;

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const make = (over: Partial<CollabProviderOptions> = {}) => {
  const doc = new Y.Doc();
  const provider = new CollabProvider(doc, {
    documentId: 'doc-1',
    user: { name: 'Ada', color: '#fff' },
    getTicket: async () => ({ ticket: 't', role: 'editor' }),
    ...over,
  });
  return { doc, provider };
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CollabProvider', () => {
  it('sends each local edit exactly once, even after several reconnects', async () => {
    const { doc, provider } = make();
    await flush();

    for (let round = 0; round < 3; round++) {
      const ws = FakeWebSocket.instances.at(-1)!;
      ws.open();
      doc.getText('t').insert(0, 'x');
      expect(updatesSent(ws)).toBe(1); // regression: used to grow with every reconnect
      ws.drop();
      await vi.advanceTimersByTimeAsync(40_000); // past any backoff
      await flush();
    }
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(4);
    provider.destroy();
  });

  it('fetches a fresh ticket for every connection attempt', async () => {
    const getTicket = vi.fn(async () => ({ ticket: `t${Math.random()}`, role: 'editor' as const }));
    const { provider } = make({ getTicket });
    await flush();
    FakeWebSocket.instances.at(-1)!.open();
    FakeWebSocket.instances.at(-1)!.drop();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(getTicket).toHaveBeenCalledTimes(2);
    provider.destroy();
  });

  it('backs off exponentially instead of hammering the server', async () => {
    const { provider } = make();
    await flush();
    const first = FakeWebSocket.instances.at(-1)!;
    first.drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(1); // still waiting (>= 0.75s)
    await vi.advanceTimersByTimeAsync(1500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    provider.destroy();
  });

  it('stops retrying and reports a fatal error when access is denied', async () => {
    const onFatal = vi.fn();
    const getTicket = vi.fn(async () => {
      throw new ApiError(404, 'Document not found');
    });
    const { provider } = make({ getTicket, onFatal });
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getTicket).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
    provider.destroy();
  });

  it('treats an access-revoked close code as fatal (no reconnect)', async () => {
    const onFatal = vi.fn();
    const { provider } = make({ onFatal });
    await flush();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.drop(4403);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onFatal).toHaveBeenCalledWith(expect.stringContaining('removed'));
    expect(FakeWebSocket.instances).toHaveLength(1);
    provider.destroy();
  });

  it('reports synced only after the server answers with its state', async () => {
    const onSynced = vi.fn();
    const { provider } = make({ onSynced });
    await flush();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    expect(onSynced).not.toHaveBeenCalled();

    const serverDoc = new Y.Doc();
    serverDoc.getText('t').insert(0, 'from server');
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep2(enc, serverDoc);
    ws.receive(encoding.toUint8Array(enc));

    expect(onSynced).toHaveBeenCalledWith(true);
    expect(provider.doc.getText('t').toString()).toBe('from server');
    ws.drop();
    expect(onSynced).toHaveBeenLastCalledWith(false);
    provider.destroy();
  });

  it('only notifies presence when the set of people changes', async () => {
    const onPresence = vi.fn();
    const { provider } = make({ onPresence });
    await flush();
    const calls = onPresence.mock.calls.length;
    provider.awareness.setLocalStateField('pointer', { x: 1, y: 2 });
    provider.awareness.setLocalStateField('pointer', { x: 3, y: 4 });
    expect(onPresence.mock.calls.length).toBe(calls);
    provider.destroy();
  });
});

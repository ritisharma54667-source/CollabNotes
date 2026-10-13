import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { api, type Role } from '../lib/api';
import { CollabProvider, type ConnectionStatus, type PresenceUser } from '../lib/collabProvider';
import { colorForName } from '../lib/colors';

export interface CollabState {
  doc: Y.Doc;
  provider: CollabProvider;
  status: ConnectionStatus;
  synced: boolean;
  /** Content is safe to show: either synced with the server or restored from the offline copy. */
  ready: boolean;
  presence: PresenceUser[];
  role: Role | null;
  fatalError: string | null;
}

interface Internal {
  doc: Y.Doc;
  provider: CollabProvider;
}

export function useCollab(documentId: string, userName: string, initialRole: Role | null): CollabState | null {
  const [instance, setInstance] = useState<Internal | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [role, setRole] = useState<Role | null>(initialRole);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(`collab-notes:${documentId}`, doc);
    void local.whenSynced.then(() => setLocalReady(true)).catch(() => setLocalReady(true));

    const provider = new CollabProvider(doc, {
      documentId,
      user: { name: userName, color: colorForName(userName) },
      getTicket: () => api.getWsTicket(documentId),
      onStatus: setStatus,
      onSynced: setSynced,
      onPresence: setPresence,
      onRole: setRole,
      onFatal: setFatalError,
    });
    setInstance({ doc, provider });

    return () => {
      provider.destroy();
      void local.destroy();
      doc.destroy();
      setInstance(null);
      setStatus('connecting');
      setSynced(false);
      setLocalReady(false);
      setPresence([]);
      setFatalError(null);
    };
  }, [documentId, userName]);

  if (!instance) return null;
  return { ...instance, status, synced, ready: synced || localReady, presence, role, fatalError };
}

import { useCallback, useEffect, useState } from 'react';
import { api, type VersionInfo } from '../lib/api';
import { timeAgo } from '../lib/format';
import Modal from './Modal';

export default function VersionHistory({ documentId, canEdit, onClose }: { documentId: string; canEdit: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listVersions(documentId).then((r) => setVersions(r.versions)).catch((e) => setError(e.message));
  }, [documentId]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Version history" onClose={onClose}>
      {canEdit && (
        <form
          className="share-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.saveVersion(documentId, label.trim());
              setLabel('');
              setNotice('Version saved.');
            });
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version (optional)" maxLength={80} aria-label="Version name" />
          <button className="btn btn-primary" disabled={busy}>Save version</button>
        </form>
      )}
      {error && <p className="error-msg" role="alert">{error}</p>}
      {notice && <p className="success-msg" role="status">{notice}</p>}
      {versions === null ? (
        <p className="muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="muted">No saved versions yet.</p>
      ) : (
        <ul className="member-list">
          {versions.map((v) => (
            <li key={v.id}>
              <div>
                <strong>{v.label}</strong>
                <div className="muted small">{v.author} · {timeAgo(v.created_at)}</div>
              </div>
              {canEdit && (
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Restore this version for everyone? The current state is saved first, so you can undo this.')) return;
                    void run(async () => {
                      await api.restoreVersion(documentId, v.id);
                      setNotice('Restored. The current state was saved as “Before restore”.');
                    });
                  }}
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, type InviteInfo, type Member } from '../lib/api';
import { parseServerDate } from '../lib/format';
import Modal from './Modal';

export default function ShareDialog({ documentId, currentUserId, onClose }: { documentId: string; currentUserId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [singleUse, setSingleUse] = useState(false);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.listMembers(documentId).then((r) => setMembers(r.members)).catch((e) => setError(e.message));
  }, [documentId]);
  useEffect(load, [load]);

  // Live links (the token itself is never retrievable again, so the list only offers revoke).
  const loadInvites = useCallback(() => {
    api.listInvites(documentId).then((r) => setInvites(r.invites)).catch((e) => setError(e.message));
  }, [documentId]);
  useEffect(loadInvites, [loadInvites]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const createLink = () =>
    run(async () => {
      const { invite } = await api.createInvite(documentId, inviteRole, singleUse);
      setLink(`${location.origin}/invite/${invite.token}`);
      setCopied(false);
      loadInvites();
    });

  const revoke = (inviteId: string) =>
    run(async () => {
      await api.revokeInvite(documentId, inviteId);
      setInvites((list) => list.filter((i) => i.id !== inviteId));
      setLink(null); // the link just shown may be the one that was revoked
    });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* the link is selectable in the input as a fallback */
    }
  };

  return (
    <Modal title="Share this document" onClose={onClose}>
      <p className="muted small">Anyone with a link can join after signing in. Links expire after 7 days, or revoke them below.</p>
      <div className="share-row">
        <select value={inviteRole} onChange={(e) => { setInviteRole(e.target.value as 'editor' | 'viewer'); setLink(null); }} aria-label="Link permission">
          <option value="editor">Can edit</option>
          <option value="viewer">Can view</option>
        </select>
        <button className="btn btn-primary" onClick={createLink}>Create invite link</button>
      </div>
      <label className="check-row small">
        <input type="checkbox" checked={singleUse} onChange={(e) => { setSingleUse(e.target.checked); setLink(null); }} />
        Single use (stops working after one person joins)
      </label>
      {link && (
        <div className="share-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
          <button className="btn btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
      )}
      {error && <p className="error-msg" role="alert">{error}</p>}

      {invites.length > 0 && (
        <>
          <h3 className="modal-sub">Active links</h3>
          <ul className="member-list" aria-label="Active invite links">
            {invites.map((i) => (
              <li key={i.id}>
                <div>
                  <strong>{i.role === 'editor' ? 'Can edit' : 'Can view'}</strong>
                  <span className="muted small">
                    {' '}{i.singleUse ? '· single use ' : ''}· expires {parseServerDate(i.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <button className="btn btn-ghost" onClick={() => revoke(i.id)} aria-label={`Revoke ${i.role} link`}>Revoke</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="modal-sub">People with access</h3>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id}>
            <div>
              <strong>{m.name}{m.id === currentUserId ? ' (you)' : ''}</strong>
              <span className="muted small"> {m.email}</span>
            </div>
            {m.role === 'owner' ? (
              <span className="role-badge">Owner</span>
            ) : (
              <div className="member-actions">
                <select
                  value={m.role}
                  aria-label={`Role for ${m.name}`}
                  onChange={(e) => run(async () => setMembers((await api.setMemberRole(documentId, m.id, e.target.value as 'editor' | 'viewer')).members))}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="btn btn-ghost" onClick={() => run(async () => { await api.removeMember(documentId, m.id); load(); })}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

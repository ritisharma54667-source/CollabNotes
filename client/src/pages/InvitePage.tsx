import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type InvitePreview } from '../lib/api';

export default function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.previewInvite(token).then((r) => setInvite(r.invite)).catch((e) => setError(e.message));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const { documentId } = await api.acceptInvite(token);
      navigate(`/doc/${documentId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card centered">
        {error ? (
          <>
            <h1>Invite unavailable</h1>
            <p className="error-msg" role="alert">{error}</p>
            <p><Link to="/">Go to your documents</Link></p>
          </>
        ) : !invite ? (
          <p className="muted">Loading invite…</p>
        ) : (
          <>
            <h1>You’re invited</h1>
            <p>Join <strong>{invite.title}</strong> ({invite.type}) as {invite.role === 'editor' ? 'an editor' : 'a viewer'}.</p>
            <button className="btn btn-primary btn-full" onClick={accept} disabled={busy}>{busy ? 'Joining…' : 'Join document'}</button>
          </>
        )}
      </div>
    </div>
  );
}

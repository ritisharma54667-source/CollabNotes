import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PresenceBar from '../components/PresenceBar';
import ShareDialog from '../components/ShareDialog';
import SyncIndicator from '../components/SyncIndicator';
import ThemeToggle from '../components/ThemeToggle';
import VersionHistory from '../components/VersionHistory';
import { useAuth } from '../hooks/useAuth';
import { useCollab } from '../hooks/useCollab';
import { api, type DocSummary } from '../lib/api';

// Editors are loaded on demand: the rich-text editor is by far the heaviest dependency.
const NotesEditor = lazy(() => import('../components/NotesEditor'));
const Whiteboard = lazy(() => import('../components/Whiteboard'));
const TaskBoard = lazy(() => import('../components/TaskBoard'));

export default function DocumentPage() {
  const { id = '' } = useParams();
  const [meta, setMeta] = useState<DocSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setMeta(null);
    setError('');
    api.getDocument(id).then((r) => setMeta(r.document)).catch((e) => setError(e.status === 404 ? 'Document not found, or you do not have access.' : e.message));
  }, [id]);

  if (error) {
    return (
      <div className="loading-screen" style={{ flexDirection: 'column', gap: 12 }}>
        <p role="alert">{error}</p>
        <Link to="/">← Back to your documents</Link>
      </div>
    );
  }
  if (!meta) return <div className="loading-screen">Loading…</div>;
  return <DocumentView key={meta.id} meta={meta} />;
}

function DocumentView({ meta }: { meta: DocSummary }) {
  const { user } = useAuth();
  const collab = useCollab(meta.id, user!.name, meta.role);
  const role = collab?.role ?? meta.role;
  const canEdit = role !== 'viewer';

  const [title, setTitle] = useState(meta.title);
  const [titleError, setTitleError] = useState('');
  const [dialog, setDialog] = useState<'share' | 'history' | null>(null);

  const commitTitle = async () => {
    const next = title.trim();
    if (!next || next === meta.title) return setTitle(meta.title);
    try {
      const { document } = await api.renameDocument(meta.id, next);
      meta.title = document.title;
      setTitle(document.title);
      setTitleError('');
    } catch (e) {
      setTitle(meta.title);
      setTitleError(e instanceof Error ? e.message : 'Could not rename');
    }
  };

  useEffect(() => {
    document.title = `${title} — CollabNotes`;
    return () => { document.title = 'CollabNotes — Real-time Team Editor'; };
  }, [title]);

  return (
    <div className="doc-page">
      <header className="doc-header">
        <Link to="/" className="back-link">← Documents</Link>
        {canEdit ? (
          <input
            className="title-input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Document title"
          />
        ) : (
          <h1 className="title-static">{title}</h1>
        )}
        <div className="doc-header-right">
          {collab && <SyncIndicator status={collab.status} synced={collab.synced} />}
          {collab && <PresenceBar users={collab.presence} />}
          <span className="role-badge">{role}</span>
          <button className="btn btn-ghost" onClick={() => setDialog('history')}>History</button>
          {role === 'owner' && <button className="btn btn-primary" onClick={() => setDialog('share')}>Share</button>}
          <ThemeToggle />
        </div>
      </header>
      {titleError && <p className="error-msg banner" role="alert">{titleError}</p>}

      <div className="doc-body">
        {collab?.fatalError ? (
          <div className="loading-screen" style={{ flexDirection: 'column', gap: 12 }}>
            <p role="alert">{collab.fatalError}</p>
            <Link to="/">← Back to your documents</Link>
          </div>
        ) : !collab || !collab.ready ? (
          <div className="loading-screen">Loading document…</div>
        ) : (
          <Suspense fallback={<div className="loading-screen">Loading editor…</div>}>
            {meta.type === 'notes' ? (
              <NotesEditor collab={collab} userName={user!.name} title={title} canEdit={canEdit} />
            ) : meta.type === 'whiteboard' ? (
              <Whiteboard collab={collab} canEdit={canEdit} title={title} />
            ) : (
              <TaskBoard collab={collab} canEdit={canEdit} title={title} />
            )}
          </Suspense>
        )}
      </div>

      {dialog === 'share' && <ShareDialog documentId={meta.id} currentUserId={user!.id} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <VersionHistory documentId={meta.id} canEdit={canEdit} onClose={() => setDialog(null)} />}
    </div>
  );
}

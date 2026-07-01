import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCollab } from '../hooks/useCollab';
import { DocumentMeta, api } from '../lib/api';
import NotesEditor from '../components/NotesEditor';
import Whiteboard from '../components/Whiteboard';
import TaskBoard from '../components/TaskBoard';
import PresenceBar from '../components/PresenceBar';
import SyncIndicator from '../components/SyncIndicator';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const { doc, awareness, status, peers } = useCollab(id!);

  useEffect(() => {
    if (id) api.getDocument(id).then(setMeta);
  }, [id]);

  if (!meta || !doc) {
    return <div className="loading-screen">Connecting to document…</div>;
  }

  return (
    <div className="doc-page">
      <header className="doc-header">
        <Link to="/" className="back-link">← Workspace</Link>
        <h1>{meta.title}</h1>
        <div className="doc-header-right">
          <SyncIndicator status={status} />
          <PresenceBar peers={peers} />
        </div>
      </header>

      <div className="doc-body">
        {meta.type === 'notes' && <NotesEditor doc={doc} awareness={awareness!} />}
        {meta.type === 'whiteboard' && <Whiteboard doc={doc} awareness={awareness!} peers={peers} />}
        {meta.type === 'tasks' && <TaskBoard doc={doc} />}
      </div>

      <footer className="doc-footer">
        <span>Document ID: <code>{id}</code></span>
        <span>Share this URL with teammates — they must be logged in to edit.</span>
      </footer>
    </div>
  );
}

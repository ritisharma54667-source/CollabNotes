import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { DocumentMeta, api } from '../lib/api';

const DOC_TYPES = [
  { type: 'notes' as const, label: 'Team Notes', icon: '📝', desc: 'Live collaborative document' },
  { type: 'whiteboard' as const, label: 'Whiteboard', icon: '🎨', desc: 'Draw together in real time' },
  { type: 'tasks' as const, label: 'Task Board', icon: '📋', desc: 'Shared Kanban board' },
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  const load = () => {
    api.listDocuments().then(setDocs).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (type: DocumentMeta['type'], label: string) => {
    setCreating(type);
    try {
      const doc = await api.createDocument(`New ${label}`, type);
      window.location.href = `/doc/${doc.id}`;
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <span className="brand-icon">◈</span>
          <span>CollabNotes</span>
        </div>
        <div className="dash-user">
          <span className="user-pill">{user?.name}</span>
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="dash-main">
        <section>
          <h2>Create workspace</h2>
          <div className="create-grid">
            {DOC_TYPES.map(({ type, label, icon, desc }) => (
              <button
                key={type}
                className="create-card"
                onClick={() => create(type, label)}
                disabled={creating === type}
              >
                <span className="create-icon">{icon}</span>
                <strong>{label}</strong>
                <span>{desc}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Your documents</h2>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="muted">No documents yet — create one above.</p>
          ) : (
            <ul className="doc-list">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link to={`/doc/${doc.id}`} className="doc-row">
                    <span className="doc-type-badge">{doc.type}</span>
                    <span className="doc-title">{doc.title}</span>
                    <span className="doc-meta">Updated {new Date(doc.updated_at).toLocaleDateString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

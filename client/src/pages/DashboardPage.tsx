import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { useAuth } from '../hooks/useAuth';
import { api, type DocSummary, type DocType } from '../lib/api';
import { timeAgo } from '../lib/format';

const TYPES: { type: DocType; icon: string; title: string; blurb: string }[] = [
  { type: 'notes', icon: '📝', title: 'Notes', blurb: 'Rich-text document' },
  { type: 'whiteboard', icon: '🎨', title: 'Whiteboard', blurb: 'Draw together' },
  { type: 'tasks', icon: '✅', title: 'Task board', blurb: 'Kanban for your team' },
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.listDocuments().then((r) => setDocs(r.documents)).catch((e) => setError(e.message));
  }, []);

  const create = async (type: DocType, label: string) => {
    setCreating(true);
    setError('');
    try {
      const { document } = await api.createDocument(`Untitled ${label.toLowerCase()}`, type);
      navigate(`/doc/${document.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create document');
      setCreating(false);
    }
  };

  const remove = async (d: DocSummary) => {
    if (!window.confirm(`Delete “${d.title}” for everyone? This cannot be undone.`)) return;
    try {
      await api.deleteDocument(d.id);
      setDocs((list) => list?.filter((x) => x.id !== d.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete document');
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (docs ?? []).filter((d) => !q || d.title.toLowerCase().includes(q));
  }, [docs, query]);

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand"><span className="brand-icon" aria-hidden>✦</span> CollabNotes</div>
        <div className="dash-user">
          <span className="user-pill">{user?.name}</span>
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="dash-main">
        <section aria-labelledby="create-h">
          <h2 id="create-h">Create new</h2>
          <div className="create-grid">
            {TYPES.map((t) => (
              <button key={t.type} className="create-card" disabled={creating} onClick={() => create(t.type, t.title)}>
                <span className="create-icon" aria-hidden>{t.icon}</span>
                <strong>{t.title}</strong>
                <span>{t.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="docs-h">
          <div className="section-head">
            <h2 id="docs-h">Your documents</h2>
            {docs && docs.length > 0 && (
              <input className="search" type="search" placeholder="Search by title…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search documents" />
            )}
          </div>
          {error && <p className="error-msg" role="alert">{error}</p>}
          {docs === null && !error && <p className="muted">Loading…</p>}
          {docs && docs.length === 0 && <p className="muted">Nothing here yet — create your first document above.</p>}
          {docs && docs.length > 0 && visible.length === 0 && <p className="muted">No documents match “{query}”.</p>}
          <ul className="doc-list">
            {visible.map((d) => (
              <li key={d.id} className="doc-item">
                <Link to={`/doc/${d.id}`} className="doc-row">
                  <span className="doc-type-badge">{d.type}</span>
                  <span className="doc-title">{d.title}</span>
                  {d.role !== 'owner' && <span className="role-badge">{d.role}</span>}
                  <span className="doc-meta">Updated {timeAgo(d.updated_at)}</span>
                </Link>
                {d.role === 'owner' && (
                  <button className="btn btn-ghost btn-icon delete-doc" onClick={() => remove(d)} aria-label={`Delete ${d.title}`} title="Delete">🗑</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, name, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon" aria-hidden>✦</div>
          <h1>CollabNotes</h1>
          <p>Real-time notes, whiteboards and task boards</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className="error-msg" role="alert">{error}</p>}
          <button className="btn btn-primary btn-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="auth-toggle">
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <button className="link-btn" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        {mode === 'register' && <p className="auth-demo-hint">Use at least 8 characters. Open a document in two browser windows to see live collaboration.</p>}
      </div>
    </div>
  );
}

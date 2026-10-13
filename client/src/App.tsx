import { Component, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import DashboardPage from './pages/DashboardPage';
import DocumentPage from './pages/DocumentPage';
import InvitePage from './pages/InvitePage';
import LoginPage from './pages/LoginPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-screen">Loading…</div>;
  // Remember where the user was going, so shared links survive the login step.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Unhandled UI error', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="loading-screen" style={{ flexDirection: 'column', gap: 12 }}>
        <p>Something went wrong.</p>
        <button className="btn btn-primary" onClick={() => (window.location.href = '/')}>Reload</button>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/invite/:token" element={<ProtectedRoute><InvitePage /></ProtectedRoute>} />
            <Route path="/doc/:id" element={<ProtectedRoute><DocumentPage /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

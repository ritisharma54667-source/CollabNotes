import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, type User } from '../lib/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Offline copies are removed on logout so the next person on a shared computer cannot read them. */
async function clearLocalDocuments() {
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.filter((d) => d.name?.startsWith('collab-notes:')).map((d) => new Promise((r) => {
        const req = indexedDB.deleteDatabase(d.name!);
        req.onsuccess = req.onerror = req.onblocked = () => r(null);
      }))
    );
  } catch {
    /* best effort */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => tokenStore.get() !== null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    void clearLocalDocuments();
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      logout,
      login: async (email, password) => {
        const r = await api.login(email, password);
        tokenStore.set(r.token);
        setUser(r.user);
      },
      register: async (email, name, password) => {
        const r = await api.register(email, name, password);
        tokenStore.set(r.token);
        setUser(r.user);
      },
    }),
    [user, loading, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

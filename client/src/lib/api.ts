export const API_BASE = '/api';
export const WS_BASE = 'ws://localhost:3002';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface DocumentMeta {
  id: string;
  title: string;
  type: 'notes' | 'whiteboard' | 'tasks';
  owner_id: string;
  owner_name?: string;
  created_at: string;
  updated_at: string;
}

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setAuth(token: string, user: User) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  register: (email: string, password: string, name: string) =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => apiFetch('/auth/me'),
  listDocuments: (): Promise<DocumentMeta[]> => apiFetch('/documents'),
  createDocument: (title: string, type: DocumentMeta['type']) =>
    apiFetch('/documents', { method: 'POST', body: JSON.stringify({ title, type }) }),
  getDocument: (id: string): Promise<DocumentMeta> => apiFetch(`/documents/${id}`),
};

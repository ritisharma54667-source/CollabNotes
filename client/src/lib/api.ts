export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export type Role = 'owner' | 'editor' | 'viewer';
export type DocType = 'notes' | 'whiteboard' | 'tasks';

export interface User {
  id: string;
  email: string;
  name: string;
}
export interface DocSummary {
  id: string;
  title: string;
  type: DocType;
  owner_id: string;
  created_at: string;
  updated_at: string;
  role: Role;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface VersionInfo {
  id: string;
  label: string;
  author: string;
  created_at: string;
}
export interface InviteInfo {
  id: string;
  role: 'editor' | 'viewer';
  singleUse: boolean;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
}
export interface InvitePreview {
  documentId: string;
  title: string;
  type: DocType;
  role: 'editor' | 'viewer';
}

const TOKEN_KEY = 'collab-notes:token';
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An expired/invalid session on a protected call logs the user out (login itself is excluded).
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const post = <T>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json: json ?? {} });
const patch = <T>(path: string, json: unknown) => request<T>(path, { method: 'PATCH', json });

export const api = {
  register: (email: string, name: string, password: string) =>
    post<{ user: User; token: string }>('/auth/register', { email, name, password }),
  login: (email: string, password: string) => post<{ user: User; token: string }>('/auth/login', { email, password }),
  me: () => request<{ user: User }>('/auth/me'),

  listDocuments: () => request<{ documents: DocSummary[] }>('/documents'),
  createDocument: (title: string, type: DocType) => post<{ document: DocSummary }>('/documents', { title, type }),
  getDocument: (id: string) => request<{ document: DocSummary }>(`/documents/${id}`),
  renameDocument: (id: string, title: string) => patch<{ document: DocSummary }>(`/documents/${id}`, { title }),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  getWsTicket: (id: string) => post<{ ticket: string; role: Role }>(`/documents/${id}/ws-ticket`),

  listMembers: (id: string) => request<{ members: Member[] }>(`/documents/${id}/members`),
  setMemberRole: (id: string, userId: string, role: 'editor' | 'viewer') =>
    patch<{ members: Member[] }>(`/documents/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => request<void>(`/documents/${id}/members/${userId}`, { method: 'DELETE' }),
  createInvite: (id: string, role: 'editor' | 'viewer', singleUse = false) =>
    post<{ invite: { id: string; token: string; role: string; singleUse: boolean; expiresAt: string } }>(`/documents/${id}/invites`, {
      role,
      singleUse,
    }),
  listInvites: (id: string) => request<{ invites: InviteInfo[] }>(`/documents/${id}/invites`),
  revokeInvite: (id: string, inviteId: string) => request<void>(`/documents/${id}/invites/${inviteId}`, { method: 'DELETE' }),

  previewInvite: (token: string) => request<{ invite: InvitePreview }>(`/invites/${token}`),
  acceptInvite: (token: string) => post<{ documentId: string; role: Role }>(`/invites/${token}/accept`),

  listVersions: (id: string) => request<{ versions: VersionInfo[] }>(`/documents/${id}/versions`),
  saveVersion: (id: string, label: string) => post<{ version: { id: string } }>(`/documents/${id}/versions`, { label }),
  restoreVersion: (id: string, versionId: string) => post<{ ok: true }>(`/documents/${id}/versions/${versionId}/restore`),
};

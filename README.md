# CollabNotes — Real-time Collaborative App

A full-stack demo of **live collaborative editing** with WebSockets, JWT authentication, and **CRDT-based conflict handling** (via [Yjs](https://yjs.dev)).

Three workspace types:
- **Team Notes** — Google Docs-style live document editing
- **Whiteboard** — shared drawing canvas with live cursors
- **Task Board** — Kanban board synced in real time

## Architecture

```
┌─────────────┐     HTTP (REST)      ┌──────────────┐
│  React App  │ ◄──────────────────► │ Express API  │
│  (Vite)     │                      │  + SQLite    │
└──────┬──────┘                      └──────────────┘
       │
       │  WebSocket (binary Yjs protocol)
       ▼
┌──────────────┐
│  WS Server   │  ← JWT auth on connect
│  (Yjs sync)  │  ← CRDT merge (conflict-free)
└──────────────┘
```

### WebSocket sync

1. Client connects: `ws://localhost:3002/{documentId}?token=JWT`
2. Server validates JWT and document access
3. Server sends **sync step 1** (document state)
4. Client/server exchange **Yjs updates** (binary, minimal diffs)
5. **Awareness protocol** broadcasts cursors, presence, pointers

### Conflict handling (CRDT)

Traditional "last write wins" loses data when two users edit simultaneously. This app uses **Yjs CRDTs**:

| Data type | Yjs structure | Behavior |
|-----------|---------------|----------|
| Notes text | `Y.Text` | Concurrent inserts at same position both survive, ordered deterministically |
| Whiteboard strokes | `Y.Map` | Each stroke has unique ID; no overwrites |
| Task cards | `Y.Array` | Array CRDT merges reorder/add/delete without conflicts |

Every edit carries a unique `(clientId, clock)` — the CRDT algorithm merges all replicas into an identical final state on every client.

### Authentication

- Register/login via REST → JWT (7-day expiry)
- HTTP routes protected with `Authorization: Bearer` header
- WebSocket connections require `?token=` query param
- Document access checked against `document_members` table

## Quick start

### Prerequisites

- Node.js 18+

### 1. Install & run server

```bash
cd server
npm install
npm run dev
```

Server runs on:
- HTTP API: `http://localhost:3001`
- WebSocket: `ws://localhost:3002`

### 2. Install & run client

```bash
cd client
npm install
npm run dev
```

Open **http://localhost:5173**

### 3. Try live collaboration

1. Register two accounts (use a normal window + incognito)
2. Create a **Team Notes** document with account A
3. Copy the document URL and open it logged in as account B
4. Type in both windows simultaneously — edits merge live with no data loss

## Project structure

```
collab-notes/
├── server/
│   └── src/
│       ├── index.ts       # Express REST API
│       ├── auth.ts        # JWT + bcrypt
│       ├── db.ts          # SQLite schema
│       ├── documents.ts   # Document CRUD + Yjs persistence
│       └── websocket.ts   # Yjs sync + awareness
└── client/
    └── src/
        ├── lib/collabProvider.ts  # WebSocket + Yjs client
        ├── components/
        │   ├── NotesEditor.tsx    # Y.Text editor
        │   ├── Whiteboard.tsx     # Y.Map strokes
        │   └── TaskBoard.tsx      # Y.Array kanban
        └── pages/
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP API port |
| `WS_PORT` | `3002` | WebSocket port |
| `JWT_SECRET` | dev secret | **Change in production** |

## Production notes

- Use PostgreSQL instead of SQLite for multi-instance deployments
- Put WebSocket behind a reverse proxy with sticky sessions, or use Redis pub/sub for multi-server Yjs sync
- Set a strong `JWT_SECRET`
- Consider [y-redis](https://github.com/yjs/y-redis) for horizontal scaling

## License

MIT

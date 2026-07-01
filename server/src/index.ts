import express from 'express';
import cors from 'cors';
import { login, register, signToken, verifyToken } from './auth.js';
import { createDocument, getDocument, joinDocument, listDocumentsForUser } from './documents.js';
import { setupWebSocketServer } from './websocket.js';

const HTTP_PORT = Number(process.env.PORT) || 3001;
const WS_PORT = Number(process.env.WS_PORT) || 3002;

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    (req as express.Request & { user: typeof payload }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name required' });
      return;
    }
    const user = register(email, password, name);
    const token = signToken(user);
    res.json({ user, token });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = login(email, password);
    const token = signToken(user);
    res.json({ user, token });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = (req as express.Request & { user: { userId: string; email: string; name: string } }).user;
  res.json({ id: user.userId, email: user.email, name: user.name });
});

app.get('/api/documents', authMiddleware, (req, res) => {
  const user = (req as express.Request & { user: { userId: string } }).user;
  res.json(listDocumentsForUser(user.userId));
});

app.post('/api/documents', authMiddleware, (req, res) => {
  const user = (req as express.Request & { user: { userId: string } }).user;
  const { title, type } = req.body;
  if (!title) {
    res.status(400).json({ error: 'Title required' });
    return;
  }
  const doc = createDocument(user.userId, title, type || 'notes');
  res.status(201).json(doc);
});

app.get('/api/documents/:id', authMiddleware, (req, res) => {
  const user = (req as express.Request & { user: { userId: string } }).user;
  const doc = getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  // Demo: anyone with the link can join as editor
  joinDocument(req.params.id, user.userId);
  res.json(doc);
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', wsPort: WS_PORT });
});

app.listen(HTTP_PORT, () => {
  console.log(`HTTP API listening on http://localhost:${HTTP_PORT}`);
});

setupWebSocketServer(WS_PORT);

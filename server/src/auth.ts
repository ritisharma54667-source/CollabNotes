import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { isUniqueViolation, one, query, type UserRow } from './db.js';
import { HttpError } from './http.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Used so unknown emails cost the same time as wrong passwords (no user enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

const toAuthUser = (u: Pick<UserRow, 'id' | 'email' | 'name'>): AuthUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
});

export async function registerUser(email: string, name: string, password: string) {
  const id = uuid();
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  try {
    await query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [id, email, name, hash]);
  } catch (err) {
    // The UNIQUE constraint is the source of truth, so two simultaneous sign-ups cannot both succeed.
    if (isUniqueViolation(err)) throw new HttpError(409, 'Email already registered');
    throw err;
  }
  const user = { id, email, name };
  return { user, token: signAccessToken(user) };
}

export async function loginUser(email: string, password: string) {
  const row = await one<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'Invalid email or password');
  const user = toAuthUser(row);
  return { user, token: signAccessToken(user) };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  return (await one<AuthUser>('SELECT id, email, name FROM users WHERE id = $1', [id])) ?? null;
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ typ: 'access' }, config.jwtSecret, { subject: user.id, expiresIn: '7d', algorithm: 'HS256' });
}

/** Short-lived, document-bound ticket used to open a WebSocket (keeps the real JWT out of URLs/logs). */
export function signWsTicket(userId: string, documentId: string): string {
  return jwt.sign({ typ: 'ws', doc: documentId }, config.jwtSecret, {
    subject: userId,
    expiresIn: '60s',
    algorithm: 'HS256',
  });
}

export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (p.typ !== 'access' || !p.sub) return null;
    return await getUserById(p.sub);
  } catch {
    return null;
  }
}

export async function verifyWsTicket(ticket: string, documentId: string): Promise<AuthUser | null> {
  try {
    const p = jwt.verify(ticket, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (p.typ !== 'ws' || p.doc !== documentId || !p.sub) return null;
    return await getUserById(p.sub);
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? await verifyAccessToken(token) : null;
    if (!user) return next(new HttpError(401, 'Authentication required'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

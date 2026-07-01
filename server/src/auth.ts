import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { db, type User } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'collab-notes-dev-secret-change-in-production';
const JWT_EXPIRES = '7d';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
}

export function register(email: string, password: string, name: string): AuthUser {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw new Error('Email already registered');

  const id = uuid();
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    name,
    password_hash
  );
  return { id, email, name };
}

export function login(email: string, password: string): AuthUser {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new Error('Invalid email or password');
  }
  return { id: user.id, email: user.email, name: user.name };
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

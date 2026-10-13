import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { app, auth, signup } from './helpers.js';

describe('auth', () => {
  it('registers, normalises the email and logs in', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: '  Mixed.Case@Example.COM ', name: 'Ada', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixed.case@example.com');
    expect(res.body.user).not.toHaveProperty('password_hash');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'MIXED.case@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('rejects duplicate emails, weak passwords and bad emails', async () => {
    const { email } = await signup();
    const dup = await request(app).post('/api/auth/register').send({ email, name: 'X', password: 'password123' });
    expect(dup.status).toBe(409);
    const weak = await request(app).post('/api/auth/register').send({ email: 'a@b.co', name: 'X', password: 'short' });
    expect(weak.status).toBe(400);
    const bad = await request(app).post('/api/auth/register').send({ email: 'nope', name: 'X', password: 'password123' });
    expect(bad.status).toBe(400);
  });

  it('gives the same error for unknown users and wrong passwords', async () => {
    const { email } = await signup();
    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'password123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it('protects /me and rejects malformed or foreign tokens', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth('garbage'))).status).toBe(401);
    const { token, user } = await signup('Grace');
    const me = await request(app).get('/api/auth/me').set(auth(token));
    expect(me.body.user.id).toBe(user.id);
  });

  it('does not accept a websocket ticket as an access token', async () => {
    const { token } = await signup();
    const doc = await request(app).post('/api/documents').set(auth(token)).send({ type: 'notes' });
    const t = await request(app).post(`/api/documents/${doc.body.document.id}/ws-ticket`).set(auth(token));
    expect((await request(app).get('/api/auth/me').set(auth(t.body.ticket))).status).toBe(401);
  });
});

describe('config', () => {
  it('refuses to start in production without JWT_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
  });
  it('refuses to start in production without DATABASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });
  it('treats empty KEY= lines (from .env.example) as unset', () => {
    const c = loadConfig({ NODE_ENV: 'development', JWT_SECRET: '', STATIC_DIR: '', CORS_ORIGINS: '' } as NodeJS.ProcessEnv);
    expect(c.staticDir).toBeUndefined();
    expect(c.jwtSecret).toContain('dev-only');
  });
  it('accepts a production config with a strong secret and no dev CORS origins', () => {
    const c = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://u:p@h:5432/d' } as NodeJS.ProcessEnv);
    expect(c.isProd).toBe(true);
    expect(c.corsOrigins).toEqual([]);
  });
});

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { query } from './db.js';
import { errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { documentsRouter } from './routes/documents.js';
import { invitesRouter } from './routes/invites.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          frameAncestors: ["'none'"],
          // Don't force https for sub-resources: that would break `docker run` on plain http://localhost.
          // TLS is terminated by the hosting platform; HSTS (set by helmet) covers real deployments.
          upgradeInsecureRequests: null,
        },
      },
    })
  );
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '100kb' }));

  const limiter = (windowMs: number, max: number) =>
    rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => config.isTest });

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness probe: healthy only while the database answers (use /healthz for plain liveness).
  app.get('/readyz', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  app.use('/api', limiter(60_000, 300));
  app.use('/api/auth/login', limiter(15 * 60_000, 20));
  app.use('/api/auth/register', limiter(60 * 60_000, 20));
  app.use('/api/auth', authRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/invites', invitesRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    const dir = path.resolve(config.staticDir);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

import http from 'node:http';
import { createApp } from './app.js';
import { attachCollabServer } from './collab/server.js';
import { flushAllRooms } from './collab/rooms.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { logger } from './logger.js';

async function main() {
  await migrate(); // fail fast (and loudly) if the database is unreachable or a migration breaks

  const app = createApp();

  const server = http.createServer(app);
  const wss = attachCollabServer(server);

  server.listen(config.port, () => {
    logger.info('Server listening', { port: config.port, env: config.env, http: '/api', websocket: '/ws/:documentId' });
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    server.close();
    wss.clients.forEach((c) => c.close(1001, 'Server restarting'));
    await flushAllRooms();
    await pool.end();
    process.exit(0);
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

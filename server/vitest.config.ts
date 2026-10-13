import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      // Tests need a real PostgreSQL. Locally: `docker compose up -d db` (see README), or set TEST_DATABASE_URL.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/collab_notes_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret',
      BCRYPT_ROUNDS: '4',
    },
  },
});

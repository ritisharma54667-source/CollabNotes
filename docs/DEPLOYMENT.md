# Deployment guide

CollabNotes is a **single stateless Node process** plus a **PostgreSQL database**. The process serves the
REST API, the WebSocket endpoint (`/ws/…`) and the built React app on one port, and runs database
migrations automatically on start-up.

> ⚠️ The app server needs a host that supports **long-lived WebSocket connections**. Serverless functions
> (Vercel/Netlify functions, Cloudflare Workers) are **not** suitable for the server. The *database* can be
> any managed PostgreSQL, including serverless ones such as Neon.

## Checklist before going live

- [ ] `DATABASE_URL` points at your PostgreSQL (managed hosts usually need `?sslmode=require`)
- [ ] `JWT_SECRET` set to a long random value (`openssl rand -base64 48`)
- [ ] `TRUST_PROXY=1` when running behind the platform's proxy
- [ ] HTTPS enabled (all platforms below do this automatically) — browsers need `wss://`
- [ ] Health checks: liveness `/healthz`, readiness `/readyz` (also verifies the database)
- [ ] **Run only one app instance** (live rooms are in memory — see *Known limitations* in the README)
- [ ] Backups enabled on the database (Neon/Supabase/Render/Railway all offer this), or schedule `pg_dump`

## 1. Get a PostgreSQL database

Pick one (all have a free tier at the time of writing — check current limits):

| Provider | How |
| --- | --- |
| **Neon** | Create a project → copy the connection string (it already includes `sslmode=require`) |
| **Supabase** | Project → *Connect* → copy the **session pooler** or direct connection string |
| **Render / Railway / Fly Postgres** | Add a PostgreSQL service in the same project as the app and use its internal URL |

Tables are created automatically on the first start; you do not run any SQL by hand.

## 2. Deploy the app

### Option A — Render

1. New **Web Service** → connect the repo → Runtime **Docker**.
2. Environment variables: `DATABASE_URL`, `JWT_SECRET` (generate), `TRUST_PROXY=1`.
3. Health check path: `/readyz`.

### Option B — Fly.io

```bash
fly launch --no-deploy            # accept the detected Dockerfile; set internal port 3001
fly secrets set JWT_SECRET="$(openssl rand -base64 48)" DATABASE_URL="postgres://…"
```

Add to `fly.toml`:

```toml
[env]
  TRUST_PROXY = "1"

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = false   # keep WebSocket sessions alive
  min_machines_running = 1

[[http_service.checks]]
  path = "/readyz"
  interval = "30s"
  timeout = "3s"
```

```bash
fly deploy
fly scale count 1                 # one instance: rooms are in memory
```

### Option C — Railway

1. New project → deploy from the repo (the Dockerfile is detected) and add the **PostgreSQL** plugin.
2. Variables: `DATABASE_URL` (reference the plugin's variable), `JWT_SECRET`, `TRUST_PROXY=1`.

### Option D — Docker anywhere (app + database)

```bash
JWT_SECRET="$(openssl rand -base64 48)" POSTGRES_PASSWORD="choose-a-password" docker compose up --build -d
```

To use an external database instead, run only the app image:

```bash
docker build -t collab-notes .
docker run -d -p 3001:3001 -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require" collab-notes
```

## Backups

```bash
pg_dump "$DATABASE_URL" --format=custom --file=collab-notes-$(date +%F).dump
pg_restore --clean --if-exists --dbname="$DATABASE_URL" collab-notes-2026-01-01.dump   # restore
```

## Changing the schema later

Append a new entry to `MIGRATIONS` in `server/src/db.ts` (never edit one that already shipped). It is applied
automatically, in a transaction, the next time the app starts.

## Splitting client and server (optional)

If you host the client on a static host (e.g. Vercel) and the server elsewhere, the client must reach the
API and WebSocket at the *same origin* or you must change the base URLs in `api.ts`/`collabProvider.ts`, add the
client origin to `CORS_ORIGINS`, and proxy `/api` and `/ws`. The single-container setup above avoids all of
that and is recommended.

## Smoke test after deploying

1. `curl https://YOUR_APP/readyz` → `{"status":"ready"}`
2. Register two users in two different browsers and open the same shared document — typing in one window
   should appear in the other within a moment, with the other person's cursor visible.
3. Restart or redeploy the app; the document content must still be there.

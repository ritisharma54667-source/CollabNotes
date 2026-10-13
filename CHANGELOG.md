# Changelog

## 1.3.0

### Security / hardening
- **`.dockerignore`**: env files are now excluded at any depth (`**/.env`, `**/.env.*`, keeping `.env.example`).
  Previously only a root-level `.env` was excluded, so `server/.env` was copied into the Docker build stage.
  *If you ever built an image with a `server/.env` present, rotate `JWT_SECRET` and the database password and
  don't share the intermediate build layers.*
- **Invite links can be revoked.** New endpoints: `GET /api/documents/:id/invites` and
  `DELETE /api/documents/:id/invites/:inviteId` (owner only). The Share dialog shows live links with a Revoke button.
- **Single-use links** (`singleUse: true`). Spent atomically (row lock), so two people racing for one link cannot both
  join; a link is not spent when opening it changes nothing (e.g. the owner opening their own link).
- Max 25 live links per document; expired and spent links are cleaned up automatically.
- **Awareness spoofing fixed.** A connection can no longer overwrite another user's cursor/presence, and is limited to
  a few awareness ids. Offending updates are dropped; the connection stays open.

### Housekeeping
- **Version history is pruned** to the newest 50 versions per document (the pre-restore safety snapshot is always kept).
- Database migration 2 (adds `single_use` / `used_at` to `document_invites`) runs automatically on start-up.
  Existing links keep working as multi-use links.
- Tests: server 32 → 44, client 29 → 32.

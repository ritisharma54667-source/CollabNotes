# syntax=docker/dockerfile:1

# ---- build the client ----
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- build the server ----
FROM node:22-bookworm-slim AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    STATIC_DIR=/app/public \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=client-build /app/client/dist ./public
RUN chown -R node:node /app
USER node
EXPOSE 3001
# The container is stateless: all data lives in PostgreSQL (DATABASE_URL), so no volume is needed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

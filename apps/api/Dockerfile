# Production image for the API — `05-infrastructure.md` §2, §3.2;
# `IMPLEMENTATION_PLAN.md` §22.8.
#
# One process runs BOTH the Express API and the BullMQ worker (§7.3): a single
# VPS at this scale does not justify a separate worker container, and the worker
# is started in-process by `src/server.js`.

# --- Dependencies -------------------------------------------------------------
# A separate stage so the production image never carries dev dependencies or the
# npm cache, and so a source-only change does not reinstall anything.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# `npm ci` — the lockfile is authoritative in a build; `npm install` would be
# free to resolve something the lockfile did not describe.
RUN npm ci --workspace apps/api --include-workspace-root --omit=dev

# --- Runtime ------------------------------------------------------------------
FROM node:22-alpine AS runtime

# `dumb-init` gives PID 1 correct signal handling, so `docker stop` reaches the
# graceful shutdown in `src/server.js` (drain, close pools) instead of killing
# the process outright.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production

WORKDIR /app

# npm workspaces hoist to the ROOT `node_modules`; there is no per-workspace
# directory to copy, and asking for one fails the build.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api ./apps/api

# The classification source data (920 kB, 14,738 rows). The seeder resolves it
# from the repository root and `ref.asset_classifications` is the reference every
# asset is classified against — so a production image without it cannot be
# seeded, which the first deploy discovers at the worst moment.
# `CLASSIFICATION_CSV_PATH` still overrides it for a bind-mounted alternative.
COPY rincian_asset.csv ./rincian_asset.csv

# The attachment root (§5.2). Declared so the path exists even before the host
# bind mount is attached; the volume is what makes it survive a redeploy.
RUN mkdir -p /storage/attachments && chown -R node:node /storage

# Never root. The image has no reason to write anywhere but /storage.
USER node

EXPOSE 3000

# `06-api.md` §11 / §8.2 — the same endpoint the compose healthcheck uses.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

# Migrations are NOT run here. `05-infrastructure.md` §11.2 requires them to run
# once as a deploy step, before the new containers serve traffic — never as a
# side effect of app boot, which would race across replicas and make a rollback
# ambiguous.
CMD ["node", "apps/api/src/server.js"]

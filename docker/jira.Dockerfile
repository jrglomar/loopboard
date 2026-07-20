# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# mcp-jira — Jira MCP HTTP bridge (:4001)
#
# The package's "build" is `tsc --noEmit` (no JS is emitted); it RUNS the
# TypeScript directly via `tsx` (npm run start:http). So the runtime image
# keeps devDependencies (tsx / typescript). This can be slimmed later by
# emitting JS and running plain `node`.
#
# Build context = repo ROOT (npm workspaces need the root manifest + lockfile).
#   docker build -f docker/jira.Dockerfile -t invokeboard/mcp-jira .
# ─────────────────────────────────────────────────────────────────────────────
# v1.65 (ADR-077, revised): Debian/glibc base — NOT alpine/musl. better-sqlite3 (pulled in by
# the root `npm ci` when STORAGE_DRIVER=sqlite) publishes prebuilt binaries for glibc but NONE
# for musl (WiseLibs/better-sqlite3 #619/#1382), so on alpine `npm ci` had to COMPILE it from
# source — which needed apk python3/make/g++ and broke on any host that can't reach Alpine's
# package CDN. On slim, prebuild-install downloads the prebuilt binary: no compiler, no apk, no
# Python. Larger base image, zero native compilation — the documented, reliable path.
FROM node:20-slim
WORKDIR /app

# Copy the WHOLE repo (`.dockerignore` drops node_modules / dist / .env), then clean-install.
# `npm ci` removes any pre-existing node_modules first, so a stray host `node_modules` that
# slipped past .dockerignore can't shadow the hoisted `tsx` binary this bridge runs at runtime.
# Force devDependencies — the bridge RUNS TypeScript via tsx (a devDep); an omitted dev tree
# (NODE_ENV=production leaking into the build) would crash it at startup with "tsx: not found".
# Inline NODE_ENV scopes to this command only; the ENV below keeps the RUNTIME production.
COPY . .
RUN NODE_ENV=development npm ci --include=dev
# Assert tsx installed — fail loud here, not with a confusing runtime "tsx: not found".
RUN node -e "console.log('tsx ->', require.resolve('tsx/package.json'))"

ENV NODE_ENV=production
EXPOSE 4001

# Liveness — the bridge's own health endpoint. Uses node (always present) rather than wget,
# which the Debian slim base does not ship (unlike alpine's busybox).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "run", "start:http", "-w", "packages/mcp-jira"]

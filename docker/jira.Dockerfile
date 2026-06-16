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
#   docker build -f docker/jira.Dockerfile -t loopboard/mcp-jira .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# 1) Install workspace deps (lockfile-exact). Copy manifests first so this layer
#    is cached until a package.json / lockfile actually changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/mcp-jira/package.json   packages/mcp-jira/package.json
COPY packages/mcp-github/package.json packages/mcp-github/package.json
COPY packages/react-app/package.json  packages/react-app/package.json
RUN npm ci --include=dev

# 2) Copy ONLY this service's source (the other workspaces keep just their
#    package.json, which is all npm needed for resolution).
COPY packages/mcp-jira packages/mcp-jira

ENV NODE_ENV=production
EXPOSE 4001

# Liveness — the bridge's own health endpoint (busybox wget ships with alpine).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4001/api/health >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "start:http", "-w", "packages/mcp-jira"]

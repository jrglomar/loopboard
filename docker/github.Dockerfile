# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# mcp-github — GitHub MCP HTTP bridge (:4002)
#
# Same shape as docker/jira.Dockerfile: runs the TypeScript via `tsx`
# (npm run start:http), so devDependencies stay in the image.
#
# Build context = repo ROOT:
#   docker build -f docker/github.Dockerfile -t invokeboard/mcp-github .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# 1) Install workspace deps (lockfile-exact). Manifests first for layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/mcp-jira/package.json   packages/mcp-jira/package.json
COPY packages/mcp-github/package.json packages/mcp-github/package.json
COPY packages/react-app/package.json  packages/react-app/package.json
RUN npm ci --include=dev

# 2) Copy ONLY this service's source.
COPY packages/mcp-github packages/mcp-github

ENV NODE_ENV=production
EXPOSE 4002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4002/api/health >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "start:http", "-w", "packages/mcp-github"]

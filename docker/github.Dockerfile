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
# v1.65 (ADR-077, revised): Debian/glibc base, not alpine — see docker/jira.Dockerfile for the
# full reasoning. This image's root `npm ci` also resolves mcp-jira's better-sqlite3 (even
# though mcp-github never touches storage), and better-sqlite3 has no musl prebuild; on slim it
# downloads the glibc prebuilt binary instead of compiling, so no apk/compiler is needed.
FROM node:20-slim
WORKDIR /app

# Copy the WHOLE repo then clean-install — same reasoning as docker/jira.Dockerfile: `npm ci`
# wipes node_modules first (no host-node_modules shadowing of the hoisted `tsx` binary), and
# NODE_ENV=development forces the devDependency tree (tsx) the bridge runs at runtime.
COPY . .
RUN NODE_ENV=development npm ci --include=dev
RUN node -e "console.log('tsx ->', require.resolve('tsx/package.json'))"

ENV NODE_ENV=production
EXPOSE 4002

# node-based liveness (Debian slim ships no wget, unlike alpine's busybox).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4002/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "run", "start:http", "-w", "packages/mcp-github"]

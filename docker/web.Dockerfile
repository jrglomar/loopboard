# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# react-app — the dashboard SPA.
#
# Two stages:
#   1) build  — Vite builds static assets into dist/
#   2) serve  — nginx serves dist/ AND reverse-proxies the two MCP bridges so
#               the browser only ever talks to ONE origin (no CORS).
#
# The bridge base URLs are baked at BUILD time (Vite `import.meta.env`). The
# defaults are same-origin proxy paths (/jira, /github) that nginx routes to the
# bridge containers. Override with --build-arg for a split SPA/API deployment
# (e.g. VITE_MCP_JIRA_URL=https://api.example.com).
#
# Build context = repo ROOT:
#   docker build -f docker/web.Dockerfile -t invokeboard/web .
# ─────────────────────────────────────────────────────────────────────────────
# v1.65 (ADR-077, revised): Debian/glibc build stage, not alpine. This stage's root `npm ci`
# resolves the whole workspace — including mcp-jira's better-sqlite3 (no musl prebuild) even
# though this image only builds the SPA. On slim, prebuild-install grabs the glibc prebuilt
# binary (no apk/compiler needed); it's discarded anyway — only dist/ is copied to the nginx
# serve stage below. The serve stage stays nginx:alpine (no Node, nothing to compile there).
FROM node:20-slim AS build
WORKDIR /app

# Copy the WHOLE repo (`.dockerignore` drops node_modules / dist / .env). We deliberately DON'T
# use the "copy manifests, install, then copy source" caching dance any more: `npm ci` does a
# CLEAN install (it removes any pre-existing node_modules first), so with the full workspace
# source present at install time this exactly mirrors a working local build — and a stray host
# `node_modules` that slipped past .dockerignore can't shadow the hoisted `vite`/`tsc`, because
# `npm ci` wipes it. (Trades layer-cache granularity for reliability; that's the right call here.)
COPY . .
# Force devDependencies (typescript, vite) even if NODE_ENV=production leaks in from the build
# environment — `--include=dev` alone can lose to an inherited production setting. Inline NODE_ENV
# scopes to this command only; `vite build` below still emits a production bundle.
RUN NODE_ENV=development npm ci --include=dev
# Assert the SPA build toolchain actually installed — fail LOUD here with the resolved path (or a
# clear "Cannot find module 'vite'") instead of a downstream, confusing "vite: not found".
RUN node -e "console.log('vite ->', require.resolve('vite/package.json')); console.log('typescript ->', require.resolve('typescript/package.json'))"

# Baked into the bundle (see packages/react-app/src/lib/mcpClient.ts).
ARG VITE_MCP_JIRA_URL=/jira
ARG VITE_MCP_GITHUB_URL=/github
ENV VITE_MCP_JIRA_URL=$VITE_MCP_JIRA_URL
ENV VITE_MCP_GITHUB_URL=$VITE_MCP_GITHUB_URL
# `build:image` = `vite build` only (no `tsc --noEmit` — the type-check is a gate concern, already
# run in `npm run typecheck` / `npm run build`; the image just needs the bundle). Build from
# WITHIN the workspace dir so the `vite` binary resolves by walking node_modules up to the hoisted
# root — independent of `npm -w` PATH quirks across npm versions (the other likely cause here).
WORKDIR /app/packages/react-app
RUN npm run build:image
WORKDIR /app

# ── Serve stage ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/react-app/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine's default CMD starts nginx in the foreground.

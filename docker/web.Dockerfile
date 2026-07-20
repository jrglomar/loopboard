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

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/mcp-jira/package.json   packages/mcp-jira/package.json
COPY packages/mcp-github/package.json packages/mcp-github/package.json
COPY packages/react-app/package.json  packages/react-app/package.json
# Force devDependencies (typescript, vite) even if NODE_ENV=production leaks in from the build
# environment — `--include=dev` alone can be overridden by an inherited production setting, and
# an omitted devDep is why `tsc`/`vite` went "not found" here. The inline NODE_ENV scopes to
# this command only; the later `vite build` still emits a production bundle.
RUN NODE_ENV=development npm ci --include=dev

COPY packages/react-app packages/react-app

# Baked into the bundle (see packages/react-app/src/lib/mcpClient.ts).
ARG VITE_MCP_JIRA_URL=/jira
ARG VITE_MCP_GITHUB_URL=/github
ENV VITE_MCP_JIRA_URL=$VITE_MCP_JIRA_URL
ENV VITE_MCP_GITHUB_URL=$VITE_MCP_GITHUB_URL
# `build:image` = `vite build` only (no `tsc --noEmit`). The type-check is a code-quality gate
# that already runs in `npm run typecheck` / `npm run build` before shipping; the image just
# needs the bundle, so it doesn't re-typecheck (faster, and tsc isn't on the deploy critical path).
RUN npm run build:image -w packages/react-app

# ── Serve stage ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/react-app/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine's default CMD starts nginx in the foreground.

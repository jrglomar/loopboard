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
FROM node:20-alpine AS build
WORKDIR /app

# v1.65 follow-up (ADR-077): same reason as docker/jira.Dockerfile — this build stage's
# root `npm ci` resolves the WHOLE workspace lockfile (all 3 package.json manifests below),
# which includes mcp-jira's better-sqlite3 dependency even though this image only builds
# the SPA. Alpine/musl has no better-sqlite3 prebuild, so `npm ci` needs a C/C++ toolchain
# to compile it here too (the compiled output itself is discarded — never copied into the
# `serve` stage below, which has no Node runtime at all).
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/mcp-jira/package.json   packages/mcp-jira/package.json
COPY packages/mcp-github/package.json packages/mcp-github/package.json
COPY packages/react-app/package.json  packages/react-app/package.json
RUN npm ci --include=dev

COPY packages/react-app packages/react-app

# Baked into the bundle (see packages/react-app/src/lib/mcpClient.ts).
ARG VITE_MCP_JIRA_URL=/jira
ARG VITE_MCP_GITHUB_URL=/github
ENV VITE_MCP_JIRA_URL=$VITE_MCP_JIRA_URL
ENV VITE_MCP_GITHUB_URL=$VITE_MCP_GITHUB_URL
RUN npm run build -w packages/react-app

# ── Serve stage ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/react-app/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine's default CMD starts nginx in the foreground.

# Deployment Guide — Loopboard

How to run the stack with Docker, what to configure, and what to harden before a
real (non-local) deployment. For local dev without Docker, see `docs/SETUP.md`.
For how the pieces connect, see `docs/ARCHITECTURE.md`.

> **What gets deployed:** the two MCP **HTTP bridges** (`mcp-jira`, `mcp-github`)
> and the **web** SPA. The **stdio** MCP servers are a local VS Code Copilot
> integration and are **not** containerized.

---

## 1. Prerequisites

- **Docker Desktop / Engine 24+** with Compose v2 (`docker compose version`).
- A **Jira Cloud API token** (Atlassian → Account → Security → API tokens) and the
  account email.
- A **GitHub token** (PAT, `repo` scope) if you want PR tools.
- The Jira **board IDs** + project keys for your Dev and PO boards.
- *(Optional)* An AI key — GitHub Models token or Anthropic key — for AI drafting.

---

## 2. Quick start (single host)

```bash
# 1) Configure
cp .env.docker.example .env
#    edit .env → real JIRA_*, GITHUB_*, board IDs (and optional AI keys)

# 2) Build + run
docker compose up --build -d

# 3) Open the dashboard
#    http://localhost:8080
```

That's it. `web` serves the SPA on `:8080` and proxies API calls to the bridges
over the internal network — so the browser only ever talks to `:8080`.

Check health:

```bash
curl http://localhost:8080/jira/api/health      # via the proxy
curl http://localhost:8080/github/api/health
# bridges are also exposed directly (optional, for debugging):
curl http://localhost:4001/api/health
curl http://localhost:4002/api/health
```

Tear down:

```bash
docker compose down            # stop + remove containers
docker compose down -v         # …and delete the loopboard-data volume (leaves/team JSON)
```

---

## 3. Configuration

### 3.1 Environment variables

All services read from the single root `.env` (`env_file: .env`). Each reads only
the keys it needs; extras are ignored. Full annotated list: `.env.docker.example`.

| Variable | Service(s) | Required | Purpose |
|---|---|---|---|
| `JIRA_BASE_URL` | jira, github | ✅ | `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | jira, github | ✅ | Atlassian account email |
| `JIRA_API_TOKEN` | jira, github | ✅ | Atlassian API token |
| `JIRA_DEV_BOARD_ID` / `JIRA_PO_BOARD_ID` | jira | ✅ | numeric board IDs |
| `JIRA_DEV_PROJECT_KEY` / `JIRA_PO_PROJECT_KEY` | jira, github | default DEV/PO | project keys |
| `JIRA_STORY_POINTS_FIELD` | jira | default `customfield_10016` | story-points custom field |
| `JIRA_LINK_TYPE`, `JIRA_FLAGGED_FIELD`, `JIRA_CODE_REVIEW_STATUSES`, `JIRA_VELOCITY_SPRINTS` | jira | defaults | field/behaviour mapping |
| `GITHUB_TOKEN` | github | ✅ | PR reads + comments |
| `GITHUB_REPO` | github | optional | default `owner/repo` |
| `AI_PROVIDER` (+ `GITHUB_MODELS_TOKEN` / `ANTHROPIC_API_KEY`) | jira | optional | enables AI drafting; unset = deterministic templates |
| `CORS_ORIGINS` | jira, github | optional | allowlist when the browser hits the bridges cross-origin (not needed with the proxy) |
| `JIRA_LEAVES_FILE` / `JIRA_TEAM_FILE` | jira | set by compose | JSON store paths (→ `/data` volume) |
| `MCP_JIRA_HTTP_PORT` / `MCP_GITHUB_HTTP_PORT` | jira / github | default 4001 / 4002 | bridge ports |

### 3.2 The SPA's bridge URLs are baked at BUILD time

The React app resolves `VITE_MCP_JIRA_URL` / `VITE_MCP_GITHUB_URL` when Vite
builds — **not** at runtime. `docker-compose.yml` passes them as build args
(default `/jira`, `/github` — the same-origin proxy paths). If you change them you
must **rebuild** the `web` image:

```bash
docker compose build web && docker compose up -d web
```

### 3.3 Persistent state

`mcp-jira` keeps two JSON files (per-sprint leaves, curated team roster). Compose
mounts the named volume `loopboard-data` at `/data` and points `JIRA_LEAVES_FILE` /
`JIRA_TEAM_FILE` there, so they survive `up`/`down`/rebuilds. Back them up by
copying out of the volume:

```bash
docker run --rm -v loopboard_loopboard-data:/data -v "$PWD":/backup alpine \
  sh -c "cp /data/.loopboard-*.json /backup/ 2>/dev/null || true"
```

---

## 4. Operations

```bash
docker compose ps                     # status + health
docker compose logs -f jira           # follow one service
docker compose logs -f                # all services
docker compose up -d --build jira     # rebuild + restart one service
docker compose restart web            # restart without rebuild
```

Each bridge has a Docker `HEALTHCHECK` hitting its own `/api/health`; `docker
compose ps` shows `healthy`/`unhealthy`.

---

## 5. Production hardening

This repo is a POC. Before exposing it beyond a trusted host:

1. **TLS / HTTPS.** Terminate TLS in front of `web` (a reverse proxy such as
   Traefik/Caddy/an LB, or cloud ingress). Don't serve creds-bearing traffic over
   plain HTTP.
2. **Secrets.** Never commit `.env`. Use your platform's secret store (Docker/
   Swarm secrets, Kubernetes Secrets, cloud secret managers) and inject at
   runtime. Rotate the Jira/GitHub tokens; prefer least-privilege scopes.
3. **Auth.** There is no user auth in front of the dashboard — anyone who can
   reach `:8080` can drive the tools with the service account's credentials. Put
   it behind SSO/an authenticating proxy, or restrict network access.
4. **CORS.** Not needed in the default proxy topology (same-origin). If you split
   the SPA and bridges across origins (see §6), set `CORS_ORIGINS` to the exact
   SPA origin(s) — avoid `*` in production.
5. **Image slimming (optional).** The bridge images currently run via `tsx` and
   include devDependencies. To slim: add a JS emit (`tsc` with `outDir`), run
   `node dist/http.js`, and `npm prune --omit=dev` (or a multi-stage copy of just
   `dist` + prod deps).
6. **Statefulness.** The JSON stores are single-node. If you run more than one
   `jira` replica, move leaves/team to a shared DB (they're isolated behind
   `leavesStore.ts` / `teamStore.ts`).
7. **Rate limits / retries.** No backoff today; transient upstream failures
   surface as `502 UPSTREAM`. Add retry/backoff in the REST clients for
   higher-traffic use.
8. **Observability.** Ship `docker compose logs` to your log stack; consider
   adding structured logging + request tracing.

---

## 6. Alternative topologies

**A. Single-origin reverse proxy (default).** Browser → `web` (nginx) → bridges.
No CORS, bridge ports private. Best for single-host. *(This is what
`docker-compose.yml` ships.)*

**B. Split SPA + API (e.g. SPA on a CDN, bridges on a server).**
- Build `web` (or just the static `dist/`) with absolute bridge URLs:
  `--build-arg VITE_MCP_JIRA_URL=https://api.example.com/jira` (etc.), or host the
  bridges on their own domains and point the VITE vars at them.
- Set `CORS_ORIGINS=https://your-dashboard.example.com` on **both** bridges.
- Serve the bridges over HTTPS.

**C. Direct exposed bridges (no nginx proxy).** Point the SPA's VITE vars at
`http://host:4001` / `:4002` and set `CORS_ORIGINS` to the SPA origin. Simplest to
reason about, but exposes the bridge ports and requires CORS.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard loads but board toggle/data missing | bridge unreachable from the browser | `docker compose ps` (is `jira` healthy?); `curl :8080/jira/api/health` |
| API calls 404 under `/jira` or `/github` | proxy path mismatch / SPA built with wrong `VITE_MCP_*_URL` | rebuild `web` with the right build args (§3.2) |
| CORS error in console | split topology without `CORS_ORIGINS` | set `CORS_ORIGINS` to the SPA origin on both bridges, redeploy |
| `jira` container exits at startup | missing required env (`JIRA_BASE_URL`/board IDs) | check `docker compose logs jira`; fill `.env` |
| `EADDRINUSE` on 4001/4002 | a host process already owns the port | stop it, or remove the `ports:` mapping (proxy still works) |
| Leaves/team reset after redeploy | volume not mounted / `down -v` used | ensure `loopboard-data` volume exists; don't use `-v` unless you mean it |
| AI drafting shows "off" | `AI_PROVIDER` unset or wrong key | set `AI_PROVIDER` + the matching token, `docker compose up -d jira` |

---

## 8. File map

| Artifact | Purpose |
|---|---|
| `docker-compose.yml` | the 3-service stack (web/jira/github) + `loopboard-data` volume |
| `docker/jira.Dockerfile`, `docker/github.Dockerfile` | bridge images (node:20 + `tsx`) |
| `docker/web.Dockerfile` | multi-stage: Vite build → nginx |
| `docker/nginx.conf` | SPA serving + `/jira`,`/github` reverse proxy |
| `.dockerignore` | keeps `node_modules`, secrets, stores out of the build context |
| `.env.docker.example` | template for `.env` |

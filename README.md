# InvokeBoard

> AI-assisted sprint management POC — Jira ticket automation, sprint dashboard, and PR auto-linking, powered by GitHub Copilot (Claude) + MCP.

**Status:** Phase 1 (ticket engine) ✅ built · Phase 2 (dashboard + GitHub) ✅ built · Phase 3 (reports) planned

---

## Quick start

Each command runs in its own terminal. Install once, then start three processes.

```
npm install
copy .env.example .env
```

Fill in your credentials in `.env` (see [Configuration](#configuration) and [docs/SETUP.md](docs/SETUP.md)).

```
npm run dev:jira:http
npm run dev:github:http
npm run dev:app
```

| What | URL |
|---|---|
| React dashboard | http://localhost:5173 |
| Jira bridge health | http://localhost:4001/api/health |
| GitHub bridge health | http://localhost:4002/api/health |

> **Copilot (stdio) note:** the stdio MCP servers are started automatically by VS Code when registered in `.vscode/mcp.json`. You do not run `npm run dev:jira` manually for Copilot use — only start `dev:jira:http` and `dev:github:http` for the dashboard.

---

## What you get

The InvokeBoard puts three capabilities directly into your sprint workflow without leaving VS Code or a browser tab.

**Ticket creation engine (Phase 1):** describe a feature in plain English and get a structured PO story and linked Dev task created in Jira instantly, with Given/When/Then acceptance criteria. Works via Copilot Chat in VS Code (say "Create a PO story and dev task for password reset via email") or via the **TicketGen** page in the dashboard. Existing tickets can be enhanced with acceptance criteria using the `enhance_ticket` prompt.

> **AI drafting in the dashboard (v1.1, optional):** set `AI_PROVIDER=anthropic` (Claude, via `ANTHROPIC_API_KEY`) or `AI_PROVIDER=github` (GitHub Models, free tier on your PAT) and the TicketGen page becomes an AI chat — it analyzes your one-liner, asks-by-stating assumptions, and produces detailed, editable ticket drafts before anything is created. The ChatPanel `create`/`enhance` commands use the same AI. Leave `AI_PROVIDER` empty and everything falls back to the deterministic local templates. See [docs/SETUP.md](docs/SETUP.md) and [docs/adr/ADR-006.md](docs/adr/ADR-006.md).

**Sprint dashboard and daily huddle (Phase 2):** the **Dashboard** page shows a live three-column board (To Do / In Progress / Done) drawn from the active sprint, with blocked issues flagged. Boards with **multiple active sprints** default to the latest-started one, and a sprint dropdown in the board header switches between them — the board and the huddle digest follow the selection (v1.1). The **HuddleDigest** widget generates a deterministic standup briefing — no LLM call required, copy it directly to your standup channel. The **ChatPanel** accepts structured commands against the live sprint data:

| Command | What it does |
|---|---|
| `help` | Show all commands |
| `huddle` | Display the daily standup digest |
| `sprint` | Show the active sprint summary card |
| `ticket <KEY>` | Show full details for a Jira ticket |
| `enhance <KEY> <notes>` | Rewrite ticket with improved ACs and context |
| `create <description>` | Create a PO story + Dev task pair |
| `prs` | List open pull requests with detected Jira keys |
| `link pr <n> [KEY]` | Link PR #n to a Jira ticket |

> Free-form natural-language questions ("Why is DEV-99 blocked?") belong in **GitHub Copilot Chat** in VS Code, not the chat panel. This is a deliberate design decision — see [docs/adr/ADR-002.md](docs/adr/ADR-002.md).

**PR-to-ticket auto-linking (Phase 2):** open a PR with a Jira key in the title, branch name, or description (`DEV-99`) and `link_pr_to_ticket` (or `sync_pr_links`) creates a remote link on the Jira ticket and posts a confirmation comment on the GitHub PR — both operations are idempotent.

---

## Configuration

Copy `.env.example` to `.env` and fill in your values. Full key-acquisition instructions are in [docs/SETUP.md](docs/SETUP.md).

| Variable | Required | Purpose |
|---|---|---|
| `JIRA_BASE_URL` | yes | Your Jira instance, e.g. `https://yourcompany.atlassian.net` |
| `JIRA_EMAIL` | yes | Email address for your Atlassian account |
| `JIRA_API_TOKEN` | yes | Atlassian API token (never committed) |
| `JIRA_PO_BOARD_ID` | yes | Board ID for the PO board (last number in the board URL) |
| `JIRA_DEV_BOARD_ID` | yes | Board ID for the Dev board (last number in the board URL) |
| `JIRA_PO_PROJECT_KEY` | optional | Project key for PO stories (default: `PO`) |
| `JIRA_DEV_PROJECT_KEY` | optional | Project key for Dev tasks (default: `DEV`) |
| `GITHUB_TOKEN` | yes (Phase 2) | GitHub PAT with `repo` scope, for PR tools |
| `GITHUB_REPO` | optional | Default repo in `owner/name` form |
| `JIRA_STORY_POINTS_FIELD` | optional | Story points custom field ID (default: `customfield_10016`) |
| `JIRA_LINK_TYPE` | optional | Issue link type name (default: `Relates`) |
| `JIRA_FLAGGED_FIELD` | optional | Custom field for blocked/flagged detection (default: disabled) |
| `MCP_JIRA_HTTP_PORT` | optional | Jira bridge port (default: `4001`) |
| `MCP_GITHUB_HTTP_PORT` | optional | GitHub bridge port (default: `4002`) |
| `VITE_MCP_JIRA_URL` | optional | Jira bridge URL seen by the app (default: `http://localhost:4001`) |
| `VITE_MCP_GITHUB_URL` | optional | GitHub bridge URL seen by the app (default: `http://localhost:4002`) |
| `AI_PROVIDER` | optional | `anthropic` or `github` to enable AI drafting in the dashboard; empty = local templates |
| `ANTHROPIC_API_KEY` | when `AI_PROVIDER=anthropic` | Claude API key — never sent to the browser |
| `ANTHROPIC_MODEL` | optional | Claude model for drafting (default: `claude-opus-4-8`) |
| `GITHUB_MODELS_TOKEN` | optional | Token for GitHub Models (default: reuses `GITHUB_TOKEN`; PAT needs `models:read`) |
| `GITHUB_MODELS_MODEL` | optional | GitHub Models model id (default: `openai/gpt-4o-mini`) |
| `GITHUB_MODELS_BASE_URL` | optional | GitHub Models endpoint (default: `https://models.github.ai/inference`) |

---

## Development

### Root scripts

| Script | What it does |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run typecheck` | Type-check all packages |
| `npm run build` | Build all packages |
| `npm run test` | Run all package test suites (no `.env` or network required) |
| `npm run dev:jira:http` | Start Jira HTTP bridge on :4001 (watch mode) |
| `npm run dev:github:http` | Start GitHub HTTP bridge on :4002 (watch mode) |
| `npm run dev:app` | Start Vite dev server on :5173 |
| `npm run dev:jira` | Start Jira stdio MCP server (Copilot only — VS Code manages this automatically) |
| `npm run dev:github` | Start GitHub stdio MCP server (Copilot only — VS Code manages this automatically) |

### Repository structure

```
invokeboard/
├── packages/
│   ├── mcp-jira/              Phase 1 — Jira MCP server
│   │   ├── src/
│   │   │   ├── index.ts       stdio MCP entry (Copilot)
│   │   │   ├── http.ts        HTTP bridge entry (:4001)
│   │   │   ├── tools/         transport-agnostic tool registry
│   │   │   └── lib/           jiraClient, adf, config, prompts, types
│   │   └── package.json
│   ├── mcp-github/            Phase 2 — GitHub MCP server
│   │   ├── src/
│   │   │   ├── index.ts       stdio MCP entry (Copilot)
│   │   │   ├── http.ts        HTTP bridge entry (:4002)
│   │   │   ├── tools/         list_prs, get_pr, link_pr_to_ticket, sync_pr_links
│   │   │   └── lib/           githubClient, jiraKeys, config, types
│   │   └── package.json
│   └── react-app/             Phase 2 — React dashboard
│       ├── src/
│       │   ├── pages/         Dashboard, TicketGen, Reports (Phase 3 stub)
│       │   ├── components/    SprintBoard, HuddleDigest, ChatPanel
│       │   ├── hooks/         useJira, useGithub, useMCP
│       │   └── lib/           mcpClient, chatRouter, ticketTemplates
│       └── package.json
├── docs/
│   ├── ARCHITECTURE.md        C4 diagrams and architectural patterns
│   ├── CONTRACTS.md           Authoritative integration contract (ports, tools, env)
│   ├── SETUP.md               Step-by-step setup guide with key acquisition
│   ├── TEST-REPORT.md         QA test results
│   ├── adr/                   Architectural Decision Records (ADR-001 to ADR-005)
│   └── poc-spec.txt           Original POC specification
├── .env.example               Root credential template (safe to commit)
├── .vscode/mcp.json           VS Code MCP server registration (auto-loaded by Copilot)
├── CLAUDE.md                  Guide for AI coding sessions
└── package.json               npm workspaces root
```

### Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — C4 diagrams, data flow walkthroughs, architectural patterns
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — authoritative tool IO, HTTP API, and env spec
- [docs/adr/](docs/adr/) — architectural decisions (stdio stdout rule, no Anthropic API, link strategy, transport, shared types)
- [docs/SETUP.md](docs/SETUP.md) — step-by-step setup with key acquisition

---

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| Phase 1 | Ticket creation engine — plain English to PO story + Dev task via MCP | ✅ Built |
| Phase 1 | Ticket enhancer — rewrite existing descriptions with acceptance criteria | ✅ Built |
| Phase 2 | Sprint dashboard — live board view with status and blockers | ✅ Built |
| Phase 2 | Daily huddle digest — AI standup briefing from sprint data | ✅ Built |
| Phase 2 | Centralized chat panel — sprint commands in the UI | ✅ Built |
| Phase 2 | GitHub MCP integration — link PRs to Jira tickets automatically | ✅ Built |
| Phase 3 | Sprint report generator — auto-draft at sprint close | Planned |
| Phase 3 | Sprint report viewer — history, PDF export, shareable link | Planned |
| Phase 3 | Velocity forecasting — suggest story point targets for next sprint | Planned |
| Phase 4+ | Blocker detection — flag tickets stuck beyond average cycle time | Suggested |
| Phase 4+ | Retro assistant — draft went-well / to-improve from sprint data | Suggested |
| Phase 4+ | Role-based dashboard views — PO, Dev, SM each see tailored data | Suggested |
| Phase 4+ | Teams integration — post huddle digest to Teams channel via MCP | Suggested |

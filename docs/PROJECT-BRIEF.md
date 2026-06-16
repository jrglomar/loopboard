# Loopboard — Project Brief (build team)

Source spec: `docs/poc-spec.txt` (text extracted from `loopboard-poc_1.pdf`, v1.0, June 2025).
Read the spec for full detail; this brief distills scope and constraints.

## What we are building

A proof of concept that integrates AI into an Agile team's workflow. GitHub Copilot
(powered by Claude) talks to **MCP servers** that bridge to Jira and GitHub; a **React
dashboard** gives the team a centralized sprint UI. It automates: writing tickets,
sprint visibility, and daily standups.

## Scope of THIS build: Phase 1 + Phase 2 only

**Phase 1 — `packages/mcp-jira`** (spec §4.2, §5, §7)
- Ticket creation engine: plain-English feature description → structured PO story +
  linked Dev task in Jira, via MCP tools `create_po_ticket` / `create_dev_ticket`.
- Ticket enhancer: rewrite existing descriptions with acceptance criteria, via
  `get_ticket` + `update_ticket` + prompt templates in `lib/prompts.ts`.
- Sprint read tools: `get_active_sprint`, `get_daily_huddle`.

**Phase 2 — `packages/react-app` + `packages/mcp-github`** (spec §7)
- Sprint dashboard: live board view with status and blockers.
- Daily huddle digest: standup briefing generated from sprint data.
- Centralized chat panel: ask about the sprint inside the UI.
- GitHub MCP integration: link PRs to Jira tickets automatically.

**OUT OF SCOPE (Phase 3+):** sprint report generator/viewer, PDF export, velocity
forecasting, blocker detection beyond simple flags, retro assistant, Teams integration,
calendar MCP. The `Reports` page ships as a labeled Phase 3 stub.

## Fixed technical decisions (spec §8 — do NOT revisit)

1. **MCP protocol**, not a custom REST API, is the AI integration surface.
2. **GitHub Copilot is the chat client.** No direct Claude/Anthropic API integration.
   The in-UI chat panel is a deterministic command router over MCP tools (see ADRs).
3. **Node.js + TypeScript** MCP servers using `@modelcontextprotocol/sdk`, `axios`, `zod`.
4. **Vite + React + TypeScript** dashboard.
5. **npm-workspaces monorepo.**
6. Jira REST API **v3** + Agile API **1.0**; rich text is **ADF**; auth is HTTP Basic
   (email + API token) read from `.env` only — never sent to the browser, never committed.

## Hard quality requirements (definition of done)

- Every package passes `npm run typecheck`, `npm run build`, and `npm run test`
  **without a `.env` file and without network access** (tests mock axios).
- Tool inputs validated with zod. No `any`. Secrets never logged.
- `docs/CONTRACTS.md` is the authoritative integration contract — all packages match it.
- Real credentials are provided by the user AFTER the build for live testing.

## Team / file ownership

| Area | Owner |
|---|---|
| `docs/ARCHITECTURE.md`, `docs/adr/`, `docs/CONTRACTS.md` | Architect agent |
| `packages/mcp-jira` | Backend agent |
| `packages/mcp-github` | Fullstack agent |
| `packages/react-app` | Frontend agent |
| Cross-package fixes, `docs/TEST-REPORT.md` | QA agent |
| `README.md`, `docs/SETUP.md`, `.vscode/mcp.json`, `CLAUDE.md`, package READMEs | TechWriter agent |

Builders must not edit files outside their package. Root `package.json`, dependency
versions, and ports are fixed by the orchestrator.

# @loopboard/mcp-github

> GitHub MCP server — links pull requests to Jira tickets via MCP stdio (Copilot) and an HTTP bridge on port 4002 (React dashboard).

## Tools

| Tool | Input | Purpose |
|---|---|---|
| `list_prs` | `repo?`, `state?` | List PRs with detected Jira keys |
| `get_pr` | `repo?`, `number` | Get full details for a single PR |
| `link_pr_to_ticket` | `repo?`, `number`, `ticketKey?` | Link a PR to Jira ticket(s) — idempotent |
| `sync_pr_links` | `repo?` | Bulk-link all open PRs to their detected Jira tickets |

Jira key detection scans the PR title, head branch name, and body using `/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g`. See `docs/CONTRACTS.md` §5 for exact input/output types.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the stdio MCP server (consumed by VS Code Copilot) |
| `npm run dev:http` | Start the HTTP bridge on port 4002 with watch mode (consumed by react-app) |
| `npm run typecheck` | TypeScript type-check (no emit) |
| `npm run build` | Alias for typecheck |
| `npm run test` | Run vitest unit tests (no .env, no network required) |

Run from the monorepo root with `-w packages/mcp-github`, e.g.:

```
npm run dev:http -w packages/mcp-github
```

## Environment variables

Create a `.env` file in this directory (or the repo root). The package-local file wins; the repo root fills any gaps. Neither file is committed. Full key-acquisition instructions are in [docs/SETUP.md](../../docs/SETUP.md).

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | GitHub PAT with `repo` scope (classic) or Pull requests + Issues Read/Write (fine-grained) |
| `JIRA_BASE_URL` | yes | — | Jira Cloud base URL, e.g. `https://acme.atlassian.net` |
| `JIRA_EMAIL` | yes | — | Jira account email (for HTTP Basic auth) |
| `JIRA_API_TOKEN` | yes | — | Jira API token (for creating remote links on tickets) |
| `GITHUB_REPO` | optional | — | Default repo (`owner/name`). Per-call `repo` arg overrides this. If both are absent, the call returns a VALIDATION error. |
| `JIRA_PO_PROJECT_KEY` | optional | `PO` | Jira PO project key for Jira key prefix filtering |
| `JIRA_DEV_PROJECT_KEY` | optional | `DEV` | Jira Dev project key for Jira key prefix filtering |
| `MCP_GITHUB_HTTP_PORT` | optional | `4002` | HTTP bridge port |

## Architecture notes

Two entry points share one transport-agnostic tool registry:

- `src/index.ts` — stdio MCP server (spawned by VS Code Copilot via `.vscode/mcp.json`)
- `src/http.ts` — Express HTTP bridge on port 4002 (consumed by `react-app`)
- `src/tools/` — transport-agnostic `ToolDef[]` registry; both entries consume it
- `src/lib/githubClient.ts` — anti-corruption layer for the GitHub REST API (Bearer token auth)
- `src/lib/jiraKeys.ts` — pure function, regex-based Jira key detection from PR metadata

Tests use `vi.mock` to stub GitHub and Jira clients — no `.env` and no network required.

See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) and [docs/CONTRACTS.md](../../docs/CONTRACTS.md) for the full design.

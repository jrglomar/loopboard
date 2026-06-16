# @loopboard/react-app

> Loopboard dashboard — sprint board, daily huddle digest, ticket generator, and chat command panel, built with Vite + React + TypeScript.

## Pages

| Page | Description |
|---|---|
| **Dashboard** | Live sprint board (3 columns by status, blocked issues flagged), HuddleDigest widget, ChatPanel |
| **TicketGen** | Form-based ticket pair generator — creates a PO story and linked Dev task via the Jira bridge |
| **Reports** | Phase 3 stub — explains what ships in Phase 3 |

## Chat commands

The ChatPanel is a deterministic command router (`src/lib/chatRouter.ts`) — it maps structured commands to bridge calls. Free-form natural-language questions belong in GitHub Copilot Chat in VS Code.

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

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Vite dev server on port 5173 |
| `npm run build` | Type-check then build for production |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | TypeScript type-check (no emit) |
| `npm run test` | Run vitest unit tests (no .env, no network required) |

Run from the monorepo root:

```
npm run dev:app
```

## Environment variables

The app reads bridge URLs from environment variables. Defaults work for local development — no `.env` is required unless you change ports. Copy `packages/react-app/.env.example` to `.env` only if you need custom bridge URLs. Full setup instructions are in [docs/SETUP.md](../../docs/SETUP.md).

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_MCP_JIRA_URL` | optional | `http://localhost:4001` | URL of the mcp-jira HTTP bridge |
| `VITE_MCP_GITHUB_URL` | optional | `http://localhost:4002` | URL of the mcp-github HTTP bridge |

> If you change `MCP_JIRA_HTTP_PORT` or `MCP_GITHUB_HTTP_PORT` in your root `.env`, update `VITE_MCP_JIRA_URL` / `VITE_MCP_GITHUB_URL` to match.

## Architecture notes

- `src/lib/mcpClient.ts` — typed HTTP client; calls bridges at `:4001` / `:4002`; throws `McpError { code, message }` on failure; emits `BRIDGE_DOWN` error with start command hint when the bridge is unreachable.
- `src/lib/chatRouter.ts` — pure function command router; fully unit-tested; no side effects.
- `src/lib/ticketTemplates.ts` — deterministic client-side ticket draft builder; no network calls.
- `src/hooks/useJira.ts` — typed hooks: `useActiveSprint`, `useDailyHuddle`, `createTicketPair`, `enhanceTicket`.
- `src/hooks/useGithub.ts` — typed hooks: `usePrs`, `linkPr`.

All data components handle loading, error, and empty states. Bridge-down errors surface the start command. No UI framework; hand-rolled CSS with CSS custom properties.

See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) and [docs/CONTRACTS.md](../../docs/CONTRACTS.md) §6 for the full design.

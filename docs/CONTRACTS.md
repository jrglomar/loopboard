# Integration Contracts

**Status: FINAL — AUTHORITATIVE (v1.9)**  
Builder agents implement exactly what this document says. If something here is
ambiguous, file a note to the Architect agent; do NOT invent new surface area or
prefer the spec over this document — this document supersedes the spec on all
implementation details.

> **v1.1 (2026-06-11), user-directed:** multiple-active-sprint selection (latest wins,
> explicit `sprintId`, `activeSprints` in output — supersedes the v1.0 `values[0]` rule)
> and optional dual-provider AI drafting endpoints on the mcp-jira bridge (§4.9,
> ADR-006/ADR-007). See Changelog v1.1 at the bottom.

---

## 1. Topology and ports

```
 VS Code Copilot (Claude)          Browser
        │ stdio (MCP)                │ HTTP (fetch)
        ▼                            ▼
 ┌──────────────┐   ┌─────────────────────────────┐
 │ mcp-jira     │   │ react-app (Vite, :5173)     │
 │ src/index.ts │   └──────┬───────────────┬──────┘
 └──────┬───────┘          │ :4001         │ :4002
        │            ┌─────▼──────┐  ┌─────▼────────┐
        │            │ mcp-jira   │  │ mcp-github   │
        │            │ src/http.ts│  │ src/http.ts  │
        │            └─────┬──────┘  └─────┬────────┘
        ▼                  ▼               ▼
   Jira Cloud REST v3 + Agile 1.0     GitHub REST + Jira REST
```

- `mcp-jira` — **stdio MCP server** (`src/index.ts`, for Copilot) **and** an
  **HTTP bridge** (`src/http.ts`, for the React app). Port **4001** (`MCP_JIRA_HTTP_PORT`).
- `mcp-github` — same dual shape. Port **4002** (`MCP_GITHUB_HTTP_PORT`).
- `react-app` — Vite dev server on **5173**; talks ONLY to the two HTTP bridges.

### 1.1 Tool registry pattern (both MCP packages — normative)

Tool handlers are transport-agnostic. Each tool module under `src/tools/` exports:

```ts
// src/lib/toolDef.ts
import { z } from "zod";

export interface ToolDef {
  name: string;
  description: string;            // read by Claude to decide when to call it
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (input: unknown) => Promise<unknown>; // impl parses with schema internally
}
```

`src/tools/index.ts` exports `export const tools: ToolDef[]`. Both entries consume it:

- **stdio entry** (`src/index.ts`): `new McpServer(...)`; for each tool call
  `server.registerTool(t.name, { description, inputSchema: t.schema.shape }, ...)`
  wrapping the result as `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`.
  On startup log **to stderr** exactly: `Jira MCP server running — waiting for tool calls...`
  (github: `GitHub MCP server running — waiting for tool calls...`).
  **Never write to stdout in stdio mode** — stdout carries MCP protocol frames.
  **Error handling in stdio adapter:** if a handler throws, catch the error and return
  `{ content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true }`.
  Do not rethrow; do not write the error to stdout.
- **HTTP bridge** (`src/http.ts`): express app exposing the registry (see §2).
  Startup log: `<service> HTTP bridge listening on http://localhost:<port>`.

## 2. HTTP bridge API (identical on both servers)

| Route | Response |
|---|---|
| `GET /api/health` | `200 { ok: true, service: "mcp-jira"\|"mcp-github", version: string, ai?: {...}, boards?: { dev: { id: number; projectKey: string }; po: { id: number; projectKey: string } } }` — `ai` + `boards` are **mcp-jira only** (§4.9, §4.9-boards); mcp-github omits them |
| `GET /api/tools` | `200 { ok: true, data: Array<{ name: string; description: string }> }` |
| `POST /api/tools/:name` (JSON body = tool input) | `200 { ok: true, data: <tool output> }` |

The `version` field in `/api/health` is the `version` string from the package's own
`package.json`. Read it at startup; do not hardcode.

Error envelope (all non-200s): `{ ok: false, error: { code: string; message: string; issues?: unknown[] } }`

| Case | Status | `code` |
|---|---|---|
| zod validation failure | 400 | `VALIDATION` (include `issues` array from zod) |
| unknown tool name | 404 | `UNKNOWN_TOOL` |
| Jira/GitHub API failure | 502 | `UPSTREAM` (friendly message, e.g. 401 → "Jira authentication failed — check JIRA_EMAIL / JIRA_API_TOKEN") |
| missing/invalid env config | 500 | `CONFIG` (message lists missing variables by name) |
| anything else | 500 | `INTERNAL` |

CORS: allowlist from **`CORS_ORIGINS`** (comma-separated; `*` = any), read at
request time, default `http://localhost:5173,http://127.0.0.1:5173` (v1.9 — was
hardcoded). Requests with no `Origin` (server-to-server / same-origin) are always
allowed. Methods `GET,POST`, header `Content-Type`. In the Docker reverse-proxy
topology the browser is same-origin, so CORS is not exercised (see
`docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md` §8).

## 3. Environment

Loading (dotenv, which never overrides already-set process env values), in order:
1. package-local `.env` (e.g. `packages/mcp-jira/.env`) — wins
2. repo-root `.env` — fills the gaps

`src/lib/config.ts` validates with zod, exposes `getConfig()` (lazy, cached) and
`resetConfigCache()` (for tests). stdio/http entries call `getConfig()` at startup to
fail fast with a clear list of missing variables (matches spec §9 "Missing Jira
credentials"). **Tool modules must not read env at import time** — only inside handlers —
so tests run with no `.env`.

| Variable | Used by | Required | Default |
|---|---|---|---|
| `JIRA_BASE_URL` | both servers | yes (no default) | — |
| `JIRA_EMAIL` | both servers | yes (no default) | — |
| `JIRA_API_TOKEN` | both servers | yes (no default) | — |
| `JIRA_PO_PROJECT_KEY` | mcp-jira | optional | `"PO"` |
| `JIRA_DEV_PROJECT_KEY` | mcp-jira | optional | `"DEV"` |
| `JIRA_PO_BOARD_ID` | mcp-jira | yes (no default) | — |
| `JIRA_DEV_BOARD_ID` | mcp-jira | yes (no default) | — |
| `JIRA_STORY_POINTS_FIELD` | mcp-jira | optional | `"customfield_10016"` |
| `JIRA_LINK_TYPE` | mcp-jira | optional | `"Relates"` |
| `JIRA_FLAGGED_FIELD` | mcp-jira | optional | `""` (disabled) |
| `JIRA_CODE_REVIEW_STATUSES` | mcp-jira | optional | `"code review,in review,peer review,review"` (v1.2) |
| `JIRA_VELOCITY_SPRINTS` | mcp-jira | optional | `6` — closed sprints averaged for velocity/forecast (v1.4) |
| `JIRA_LEAVES_FILE` | mcp-jira | optional | `<mcp-jira pkg>/.loopboard-leaves.json` — JSON store for per-sprint leaves (v1.5) |
| `JIRA_TEAM_FILE` | mcp-jira | optional | `<mcp-jira pkg>/.loopboard-team.json` — JSON store for the per-board team roster (v1.8) |
| `GITHUB_TOKEN` | mcp-github | yes (no default) | — |
| `GITHUB_REPO` | mcp-github | optional (used as default repo) | — |
| `MCP_JIRA_HTTP_PORT` | mcp-jira | optional | `4001` |
| `MCP_GITHUB_HTTP_PORT` | mcp-github | optional | `4002` |
| `CORS_ORIGINS` | mcp-jira, mcp-github | optional | `"http://localhost:5173,http://127.0.0.1:5173"` — comma-separated allowlist; `*` = any (v1.9) |
| `AI_PROVIDER` | mcp-jira | optional | `""` (AI drafting disabled) — `"anthropic"` or `"github"` |
| `ANTHROPIC_API_KEY` | mcp-jira | required iff `AI_PROVIDER=anthropic` | — |
| `ANTHROPIC_MODEL` | mcp-jira | optional | `"claude-opus-4-8"` |
| `GITHUB_MODELS_TOKEN` | mcp-jira | optional (falls back to `GITHUB_TOKEN`) | — |
| `GITHUB_MODELS_MODEL` | mcp-jira | optional | `"openai/gpt-4o-mini"` |
| `GITHUB_MODELS_BASE_URL` | mcp-jira | optional | `"https://models.github.ai/inference"` |
| `VITE_MCP_JIRA_URL` | react-app | optional | `"http://localhost:4001"` |
| `VITE_MCP_GITHUB_URL` | react-app | optional | `"http://localhost:4002"` |

**Clarification on Required vs. Optional:** "yes (no default)" means the server will exit
at startup with a `CONFIG` error if the variable is absent. "optional" means the server
starts with the listed default; no startup failure. `GITHUB_REPO` is optional because
individual tool calls may supply `repo` explicitly; if a call omits `repo` and
`GITHUB_REPO` is also unset, return a `VALIDATION` error for that call.

Jira auth: HTTP Basic — `Authorization: Basic base64(email:token)`.
GitHub auth: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2022-11-28`. Base URL `https://api.github.com`.

## 4. mcp-jira tools (Phase 1) — exact IO

Shared types (define in `src/lib/types.ts`):

```ts
export interface TicketRef { key: string; url: string; board: "PO" | "DEV" }

export interface IssueSummary {
  key: string;
  summary: string;
  status: string;                       // e.g. "In Progress"
  statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null;              // display name
  assigneeAccountId: string | null;     // v1.8 — Jira accountId (for assignment + roster derivation)
  storyPoints: number | null;
  issueType: string;                    // "Story", "Task", "Bug", ...
  url: string;                          // browse URL
  blocked: boolean;
}

export interface HuddleItem {
  key: string;
  summary: string;
  assignee: string | null;
  status: string;
}
```

`url` is always `${JIRA_BASE_URL}/browse/${key}`.

**Blocked detection** (used by `get_active_sprint` and `get_daily_huddle`): an issue is
blocked if `JIRA_FLAGGED_FIELD` is set (non-empty string) and that field is truthy/non-empty
on the issue, OR the issue's labels array includes `"blocked"` (case-insensitive match),
OR the issue's status name contains `"block"` (case-insensitive substring match).

**Category precedence in `get_daily_huddle`:** done always wins — an issue in statusCategory
`"done"` goes into the `done` bucket even if `blocked === true`.

**Code-review detection (v1.2 — used by `get_active_sprint` and `get_daily_huddle`):**
an issue is *in code review* iff its `statusCategory` is `"inprogress"` AND its status
name — lowercased and trimmed — exactly matches one of the entries in
`JIRA_CODE_REVIEW_STATUSES` (comma-separated env var, each entry lowercased/trimmed;
default `"code review,in review,peer review,review"`). The category guard means a
done-category status like "Reviewed" can never be pulled out of `done`, and a todo-category
status never out of `todo`. `IssueSummary.statusCategory` keeps reporting Jira's raw
category — code review is a *bucketing* concept, not a field change.

**Add-to-sprint helper (v1.4 — shared by §4.1/§4.2, ADR-011):** when a creation tool is
given an optional `sprintId`, after the issue is created call
`POST /rest/agile/1.0/sprint/{sprintId}/issue` with `{ "issues": ["<new-key>"] }` to move
it into that sprint. This **must be non-fatal** — failure (e.g. the issue's project is not
on that sprint's board) returns the created ticket with `sprintWarning: "<message>"`; on
success the output includes `sprintId: <number>`. Tickets can only join a sprint whose
board filter includes their project; Dev tickets → the Dev board's sprints is the common
case.

### 4.1 `create_po_ticket`
- **Input:** `{ summary: string (1–255 chars), description: string, storyPoints?: number (≥ 0), sprintId?: number }`
- **Behavior:** create issue type `Story` in `JIRA_PO_PROJECT_KEY` via
  `POST /rest/api/3/issue`. Description converted to ADF (§4.7). `storyPoints` →
  `JIRA_STORY_POINTS_FIELD`, omitted from the payload when not provided. If `sprintId` is
  present, apply the add-to-sprint helper above (non-fatal).
- **Output:** `TicketRef & { sprintId?: number; sprintWarning?: string }` with `board: "PO"`.

### 4.2 `create_dev_ticket`
- **Input:** `{ summary: string (1–255 chars), description: string, linkedPoTicketKey?: string, sprintId?: number }`
- **Behavior:** create issue type `Task` in `JIRA_DEV_PROJECT_KEY`. If
  `linkedPoTicketKey` is present, call `POST /rest/api/3/issueLink` with payload:
  ```json
  { "type": { "name": "<JIRA_LINK_TYPE>" },
    "inwardIssue": { "key": "<dev-key>" },
    "outwardIssue": { "key": "<linkedPoTicketKey>" } }
  ```
  (See ADR-003 for the deliberate deviation from spec §4.3 "parent/child".)
  Link failure must NOT fail the creation: return the ticket and include
  `linkWarning: "<error message>"` in the output. On success with linking,
  `linkedTo` is the value of `linkedPoTicketKey`. If `sprintId` is present, apply the
  add-to-sprint helper above (non-fatal) AFTER the link step.
- **Output:**
  ```ts
  TicketRef & { linkedTo?: string; linkWarning?: string;
                sprintId?: number; sprintWarning?: string }
  // board is always "DEV"
  ```

### 4.3 `get_active_sprint`
- **Input:** `{ boardId?: number, sprintId?: number, maxResults?: number }` — `boardId`
  defaults to `parseInt(JIRA_DEV_BOARD_ID)`; `maxResults` defaults to `50`; `sprintId`
  selects a specific **active OR future** sprint on the board (v1.4).
- **Sprint selection (v1.4 — extends ADR-007 to future sprints; ADR-011):**
  1. `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future` → split `values`
     into active and future lists. If BOTH are empty/absent, return an `UPSTREAM` error
     `"No active or future sprint found for board <boardId>"`.
  2. Map active → `activeSprints: ActiveSprintRef[]` and future →
     `futureSprints: ActiveSprintRef[]`, each sorted: active **latest-first** (desc
     `startDate`, null last, ties desc `id`); future **earliest-first** (asc `startDate`,
     null last, ties asc `id` — the *next* sprint comes first).
  3. Selection: if `sprintId` is provided, select the matching sprint from
     active ∪ future — if it is in neither, return an `UPSTREAM` error
     `"Sprint <sprintId> is not an active or future sprint on board <boardId>"`. Otherwise
     default to the first active sprint (latest-started); if there are NO active sprints,
     default to the first future sprint (the next one).
- **Behavior (continued):**
  4. `GET /rest/agile/1.0/sprint/{selectedSprintId}/issue?maxResults={maxResults}`
  5. Map each issue to `IssueSummary` using blocked detection rules above.
  6. Bucket each issue (v1.2): `codereview` if the code-review detection above matches;
     otherwise its `statusCategory` (`todo` / `inprogress` / `done`). The `inprogress`
     bucket therefore EXCLUDES code-review issues.
  7. Compute `totals`: count issues per bucket (`todo`/`inprogress`/`codereview`/`done`),
     count `blocked` issues (those with `blocked === true` regardless of bucket), sum
     `storyPoints` for `storyPointsTotal` (null values count as 0), sum `storyPoints` for
     done-bucket issues for `storyPointsDone`.
- **Output:**
```ts
export interface ActiveSprintRef {
  id: number; name: string;
  startDate: string | null; endDate: string | null; goal: string | null;
}

{
  sprint: { id: number; name: string; state: string;   // "active" | "future"
            startDate: string | null; endDate: string | null; goal: string | null };
  activeSprints: ActiveSprintRef[];   // ALL active sprints, latest-first (v1.1)
  futureSprints: ActiveSprintRef[];   // ALL future sprints, earliest-first — next-up first (v1.4)
  issuesByStatus: { todo: IssueSummary[]; inprogress: IssueSummary[];
                    codereview: IssueSummary[];           // v1.2
                    done: IssueSummary[] };
  totals: { total: number; todo: number; inprogress: number;
            codereview: number;                            // v1.2
            done: number;
            blocked: number; storyPointsTotal: number; storyPointsDone: number;
            storyPointsCodeReview: number;                 // v1.5 — sum of code-review bucket points
          };
}
```
  `storyPointsDone` stays strictly the done bucket (the Done column count). `storyPointsCodeReview`
  is the code-review bucket's points — the Dashboard's DoD progress (ADR-014) treats
  `storyPointsDone + storyPointsCodeReview` as completed, while the board still shows Code
  Review as its own column.
  `startDate`, `endDate`, `goal` are `null` when absent in Jira's response.
  The selected sprint always appears in `activeSprints` OR `futureSprints`. A future sprint
  typically has few/no issues — all four buckets may be empty; the board renders normally.
  `sprint.state` lets the UI label a future selection.

### 4.4 `get_ticket`
- **Input:** `{ ticketKey: string }` — validate with zod `.regex(/^[A-Z][A-Z0-9]{1,9}-\d+$/, "ticketKey must match PROJECT-NUMBER format")`.
- **Behavior:** `GET /rest/api/3/issue/{ticketKey}`. A 404 from Jira returns an
  `UPSTREAM` error with message `"Ticket <ticketKey> not found"`.
- **Output:**
```ts
{
  key: string; url: string; summary: string;
  description: string;                  // plain text extracted from ADF (§4.7)
  status: string; statusCategory: "todo" | "inprogress" | "done";
  assignee: string | null; reporter: string | null;
  storyPoints: number | null; issueType: string;
  labels: string[];
  created: string;   // ISO 8601, from Jira fields.created (e.g. "2025-06-01T09:00:00.000+0000")
  updated: string;   // ISO 8601, from Jira fields.updated — pass through as-is, do not reformat
}
```

### 4.5 `update_ticket`
- **Input:** `{ ticketKey: string, summary?: string, description?: string }` — zod
  `.refine` that at least one of `summary`/`description` is present, with message
  `"At least one of summary or description must be provided"`.
- **Behavior:** `PUT /rest/api/3/issue/{ticketKey}` with body:
  ```json
  { "fields": { ...only fields provided... } }
  ```
  When `description` is provided, convert to ADF via `textToAdf()` before placing in
  `fields.description`. When `summary` is provided, place directly in `fields.summary`.
  Jira returns `204 No Content` on success. A 404 returns `UPSTREAM` error
  `"Ticket <ticketKey> not found"`.
- **Output:** `{ key: string; url: string; updatedFields: string[] }`
  `updatedFields` contains the names of the fields that were included in the PUT body:
  `"summary"` if summary was provided, `"description"` if description was provided.
  Both may appear. Never empty (the zod refine prevents it).

### 4.6 `get_daily_huddle`
- **Input:** `{ boardId?: number, sprintId?: number }` — `boardId` defaults to
  `parseInt(JIRA_DEV_BOARD_ID)`; `sprintId` uses the same active-sprint selection rule
  as §4.3 (latest active sprint when omitted; `UPSTREAM` error when not active).
- **Behavior:** reuses the active-sprint fetch and selection (same logic as §4.3,
  maxResults: 50), then classifies issues into buckets (precedence top to bottom, v1.2):
  - `done` — statusCategory `"done"` (done always wins; see category precedence note above).
  - `blocked` — `blocked === true` AND statusCategory is NOT `"done"` (a blocked
    code-review issue lands here, not in `codeReview`).
  - `codeReview` — code-review detection matches (see above) AND not blocked. (v1.2)
  - `inProgress` — statusCategory `"inprogress"` AND `blocked === false` AND not in
    code review.
  - `upNext` — statusCategory `"todo"` AND `blocked === false`, first 5 in the order
    returned by the Jira sprint issue API (board order).
  An issue can appear in at most one bucket. Issues that are `"todo"` and not blocked but
  beyond position 5 are omitted from output (they appear in `get_active_sprint` data).
  `summaryText` is a deterministic digest built as (v1.2 format):
  `"Sprint '<name>' (<startDate> – <endDate>): <total> issues — <inProgress count> in progress, <codeReview count> in code review, <blocked count> blocked (<blocked keys comma-separated>), <done count> done, <upNext count> up next."`.
  If there are no blocked issues, omit the parenthetical (the `0 blocked,` text remains).
  Counts are BUCKET counts (so `in progress` excludes code review). Dates formatted as
  `YYYY-MM-DD` (take the date portion of ISO string). **No LLM call.**
- **Output:**
```ts
{
  sprintName: string; sprintId: number; boardId: number;     // sprintId added in v1.1
  generatedAt: string;  // ISO timestamp (new Date().toISOString())
  inProgress: HuddleItem[]; codeReview: HuddleItem[];        // codeReview added in v1.2
  blocked: HuddleItem[];
  done: HuddleItem[]; upNext: HuddleItem[];
  summaryText: string;
}
```

### 4.7 ADF helpers (`src/lib/adf.ts`)
- `textToAdf(text: string)` — deterministic converter supporting: blank-line-separated
  paragraphs, `## ` headings (level 2/3), `- ` bullet lists. No external deps.
- `adfToText(adf: unknown): string` — walks any ADF doc collecting text nodes;
  paragraphs/headings/list items separated by newlines. Tolerates null/absent doc → `""`.

### 4.8 MCP prompts (`src/lib/prompts.ts`, registered in stdio entry only)
- `draft_tickets` (arg `featureDescription`) — instructs Claude to draft a PO story +
  Dev task each with Given/When/Then acceptance criteria, then call `create_po_ticket`
  and `create_dev_ticket` (passing the new PO key).
- `enhance_ticket` (arg `ticketKey`) — instructs Claude to `get_ticket`, rewrite the
  description with context/scope/ACs, then `update_ticket`.
- `daily_huddle` (optional arg `boardId`) — instructs Claude to call `get_daily_huddle`
  and present a crisp standup briefing.
Registered via `server.registerPrompt(...)`; templates exported as pure functions so
they are unit-testable.

### 4.9 AI drafting endpoints (v1.1 — mcp-jira HTTP bridge ONLY, NOT MCP tools)

**These are bridge-only REST endpoints.** They are NOT registered in the tool registry and
do NOT appear on the stdio MCP server or in `GET /api/tools` — Copilot/Claude already
drafts via the MCP prompts (§4.8); routing an LLM's tool call back into another LLM would
be circular. See ADR-006 (amends ADR-002: the React UI gets real AI drafting, key stays
server-side, deterministic fallback preserved).

**Provider port (`src/lib/ai/provider.ts`):**
```ts
export interface AiCompletion { text: string }          // raw JSON text from the model
export interface AiProvider {
  readonly name: "anthropic" | "github";
  readonly model: string;
  /** messages: system handled separately; throws UpstreamError on API failure */
  complete(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>,
           options: { maxTokens: number }): Promise<AiCompletion>;
}
```
- `getAiProvider(): AiProvider | null` — returns `null` when `AI_PROVIDER` is unset/empty.
  Throws `ConfigError` at first use when `AI_PROVIDER=anthropic` but `ANTHROPIC_API_KEY`
  is missing, or `AI_PROVIDER=github` but neither `GITHUB_MODELS_TOKEN` nor `GITHUB_TOKEN`
  is set. Lazy — no env reads at import time (same rule as §3).
- **Anthropic adapter** — MUST use the official `@anthropic-ai/sdk` (installed: 0.104.1)
  with structured outputs. Verified pattern against the installed SDK:
  ```ts
  import Anthropic from "@anthropic-ai/sdk";
  import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
  import * as z from "zod/v4";   // ← AI schemas use the zod/v4 subpath (zod 3.25.76);
                                 //    the rest of the codebase stays on v3 ("zod")
  const client = new Anthropic({ apiKey });
  const res = await client.messages.parse({
    model,                        // default "claude-opus-4-8"
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system,
    messages,                     // [{ role: "user" | "assistant", content: string }]
    output_config: { format: zodOutputFormat(Schema) },   // single argument
  });
  res.parsed_output               // typed result | null
  ```
  Error mapping: `Anthropic.AuthenticationError` → `UpstreamError` "Anthropic
  authentication failed — check ANTHROPIC_API_KEY"; `Anthropic.RateLimitError` →
  "Anthropic rate limit reached — retry shortly"; other `Anthropic.APIError` → message
  with status. Never send `temperature`/`top_p`/`top_k` (400 on this model family).
  Implementation note: since `messages.parse` already returns typed output, the Anthropic
  adapter MAY bypass the generic `complete()` JSON path and expose the parsed object
  directly — keep the `AiProvider` interface satisfied either way.
- **GitHub Models adapter** — raw `fetch` (no SDK exists):
  `POST {GITHUB_MODELS_BASE_URL}/chat/completions` with headers
  `Authorization: Bearer <GITHUB_MODELS_TOKEN ?? GITHUB_TOKEN>`,
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
  `Content-Type: application/json`; body
  `{ model, messages: [{ role: "system", content: system }, ...messages], max_tokens,
  response_format: { type: "json_object" } }`. Response text =
  `choices[0].message.content`. Parse with the zod schema; on parse failure retry ONCE
  with an appended user message `"Your previous reply was not valid JSON matching the
  required schema. Reply with ONLY the JSON object."`; second failure → `UpstreamError`
  "AI returned an unparseable response". 401/403 → `UpstreamError` "GitHub Models
  authentication failed — check GITHUB_MODELS_TOKEN / GITHUB_TOKEN (PAT needs models:read)".
  404 → include hint "check GITHUB_MODELS_BASE_URL".

**Endpoints (mcp-jira `src/http.ts`):**

`POST /api/ai/draft-tickets`
- **Input (zod):** `{ messages: Array<{ role: "user" | "assistant"; content: string (1–4000) }>
  (min 1, last entry must have role "user" — zod refine), storyPoints?: number (≥ 0) }`
- **Behavior:** build the system prompt from the SAME ticket conventions as
  `lib/prompts.ts`/`ticketTemplates` (user-story phrasing, Given/When/Then ACs, dev
  implementation checklist, "## " headings + "- " bullets so ADF conversion works),
  instructing the model to: analyse the conversation, enhance terse input into a detailed
  ticket pair, and return JSON `{ assistantMessage, po: { summary, description,
  storyPoints }, dev: { summary, description } }`. `assistantMessage` is a short
  conversational reply (what it understood / what it improved / any assumptions).
  Multi-turn: the full `messages` history is sent each call so follow-ups refine drafts.
- **Output:** `{ assistantMessage: string; po: { summary: string; description: string;
  storyPoints: number | null }; dev: { summary: string; description: string };
  provider: "anthropic" | "github"; model: string }`
- The endpoint does NOT create anything in Jira — the client reviews drafts then calls
  the existing `create_po_ticket`/`create_dev_ticket` tools.

`POST /api/ai/enhance-ticket`
- **Input (zod):** `{ ticketKey: string (same regex as §4.4), notes?: string (≤2000),
  current: { summary: string; description: string } }`
- **Behavior:** system prompt instructs the model to rewrite the ticket with clear
  context/scope + Given/When/Then ACs, incorporating `notes`, preserving real facts from
  `current`. Returns JSON `{ assistantMessage, summary, description }`.
- **Output:** `{ assistantMessage: string; summary: string; description: string;
  provider: "anthropic" | "github"; model: string }`
- The endpoint does NOT call Jira — the client flow is `get_ticket` → this endpoint →
  `update_ticket` (keeps the endpoint pure-AI and testable; reuses existing tool I/O).

`POST /api/ai/sprint-summary` (v1.4 — Phase 3 reports; ADR-012)
- **Input (zod):** the report payload the client already holds —
  `{ sprintName: string, state: string, startDate?: string, endDate?: string,
  goal?: string | null, committedPoints: number, completedPoints: number,
  completedCount: number, totalCount: number, carryoverCount: number,
  blockedCount: number, byAssignee: Array<{ name: string; donePoints: number;
  totalPoints: number; doneCount: number; totalCount: number }> }` (all derived from
  `get_sprint_report`).
- **Behavior:** system prompt asks the model for a concise, professional **sprint-review
  executive summary** (3–6 sentences + a short "highlights / risks / next" structure):
  what was committed vs delivered, notable carryover/blockers, per-team observations, and
  a forward note. Plain prose (markdown ok). Returns JSON `{ summary }`.
- **Output:** `{ summary: string; provider: "anthropic" | "github"; model: string }`
- Pure-AI, no Jira call. Same provider port + error mapping as the other AI endpoints.

**Errors (all AI endpoints):**
| Case | Status | `code` |
|---|---|---|
| `AI_PROVIDER` unset/empty | 503 | `AI_UNAVAILABLE`, message `"AI drafting is disabled — set AI_PROVIDER=anthropic or github and the matching key (see docs/SETUP.md)"` |
| provider configured but key missing | 500 | `CONFIG` (names the missing variable) |
| provider API failure | 502 | `UPSTREAM` (friendly messages above) |
| zod validation | 400 | `VALIDATION` |

**`GET /api/health` (mcp-jira)** gains `ai: { enabled: boolean; provider: "anthropic" |
"github" | null; model: string | null }` — `enabled: false, provider: null, model: null`
when `AI_PROVIDER` is unset. The React app uses this to pick AI vs deterministic mode.

**`GET /api/health` (mcp-jira) also gains `boards` (v1.6, ADR-017)** — the configured board
context so the React app can offer a PO/Dev switch without knowing env values:
```ts
boards: {
  dev: { id: number; projectKey: string };   // JIRA_DEV_BOARD_ID + JIRA_DEV_PROJECT_KEY
  po:  { id: number; projectKey: string };    // JIRA_PO_BOARD_ID  + JIRA_PO_PROJECT_KEY
}
```
Pure config (no Jira call). All existing board-scoped tools (`get_active_sprint`,
`get_daily_huddle`, `list_sprints`, `get_sprint_report`, `get_velocity`, `create_sprint`)
already accept `boardId` — the app passes `boards.dev.id` or `boards.po.id`; no tool
signature changes.

**Quality gates:** all §4.9 tests run keyless/offline — mock the Anthropic SDK module and
global fetch; cover: AI_UNAVAILABLE 503, missing-key CONFIG, happy path per provider,
GitHub JSON-retry path, provider error mapping, validation failures.

## 4.10–4.13 Sprint management + reports tools (v1.4 — real MCP tools; ADR-011/012)

These ARE MCP tools (registered in the tool registry, stdio server, `GET /api/tools`, and
the HTTP bridge) — Jira reads/writes Claude can legitimately perform. Shared type:

```ts
export interface SprintRef {
  id: number; name: string; state: "active" | "future" | "closed";
  startDate: string | null; endDate: string | null;
  completeDate: string | null;            // closed sprints only, else null
  goal: string | null; boardId: number;
}
```

### 4.10 `create_sprint` (WRITE)
- **Input:** `{ name: string (1–255), goal?: string, startDate?: string, endDate?: string, boardId?: number }`
  — `boardId` defaults to `parseInt(JIRA_DEV_BOARD_ID)`. Dates are ISO 8601; zod `.refine`
  that if both are present, `startDate < endDate`.
- **Behavior:** `POST /rest/agile/1.0/sprint` with
  `{ name, originBoardId: boardId, goal?, startDate?, endDate? }`. Jira creates a **future**
  sprint. Jira wants full ISO timestamps — if the client sends date-only (`YYYY-MM-DD`),
  the server normalizes to `...T00:00:00.000Z` before sending.
- **Output:** `SprintRef` (the created sprint; `state` will be `"future"`).
- **Description (for Claude):** "Create a new future sprint on the board with a name, goal,
  and optional start/end dates." Stdio + HTTP both expose it (a deliberate write tool).

### 4.11 `list_sprints`
- **Input:** `{ boardId?: number, state?: "active" | "future" | "closed" | "all" (default "all"), maxResults?: number (default 50) }`
- **Behavior:** `GET /rest/agile/1.0/board/{boardId}/sprint?state=<states>` (for `"all"`
  request `active,future,closed`). Map to `SprintRef[]`. Sort: closed latest-first by
  `completeDate`/`startDate`, then active latest-first, then future earliest-first — OR,
  simpler and specified: return three arrays.
- **Output:** `{ boardId: number; active: SprintRef[]; future: SprintRef[]; closed: SprintRef[] }`
  (each sorted as in §4.3 conventions; closed sorted latest-completed first). When a single
  `state` is requested, the other arrays are empty.

### 4.12 `get_sprint_report`
- **Input:** `{ sprintId: number, maxResults?: number (default 100) }`
- **Behavior:** `GET /rest/agile/1.0/sprint/{sprintId}` (meta) + `GET
  /rest/agile/1.0/sprint/{sprintId}/issue?maxResults=...`. **Definition of Done (v1.5,
  ADR-014):** an issue is **completed** if `statusCategory === "done"` **OR** it matches the
  code-review detection (§4.3 / `JIRA_CODE_REVIEW_STATUSES`) — i.e. done OR in code review.
  **notCompleted** = everything else (carryover). Compute points via
  `JIRA_STORY_POINTS_FIELD` (null → 0). `byAssignee.donePoints`/`doneCount` likewise count
  done-or-code-review as done.
- **Output:**
```ts
{
  sprint: SprintRef;
  committedPoints: number;     // sum of ALL issues' points
  completedPoints: number;     // sum of completed (done OR code-review) issues' points
  completionRate: number;      // completedPoints / committedPoints, 0 when committed=0
  totalCount: number; completedCount: number; carryoverCount: number;
  blockedCount: number;
  completed: IssueSummary[];   // done OR code-review issues
  notCompleted: IssueSummary[];// carryover (todo + inprogress that is NOT code-review; blocked flagged)
  byAssignee: Array<{ name: string;   // display name, "Unassigned" for null
                      donePoints: number; totalPoints: number;
                      doneCount: number; totalCount: number }>;  // sorted by totalPoints desc
}
```

### 4.13 `get_velocity`
- **Input:** `{ boardId?: number, sprintCount?: number (default `JIRA_VELOCITY_SPRINTS` → 6), beforeSprintId?: number }`
- **Behavior:** list closed sprints (latest-completed first). **Selected-sprint context
  (v1.5, ADR-015):** when `beforeSprintId` is provided, consider only the closed sprints
  that come **before** that sprint — i.e. exclude `beforeSprintId` itself and any closed
  sprint whose `completeDate` (fallback `startDate`) is not earlier than the selected
  sprint's `startDate` (fallback `completeDate`). This makes the Reports velocity "the N
  sprints prior to the one I'm looking at." When `beforeSprintId` is omitted, use the
  latest closed sprints (prior behavior). Take the first `sprintCount`, run the
  `get_sprint_report` point math per sprint (completed uses the same DoD = done OR code
  review, §4.12), reverse to chronological order. `averageCompleted` = mean of
  `completedPoints` (0 when none). **Forecast** = that average (≤2 decimals), labeled a
  heuristic — NOT a promise. (The UI further adjusts this for leaves — §6, ADR-016 — but
  this tool returns the raw, unadjusted velocity.)
- **Output:**
```ts
{
  boardId: number; sprintCount: number;
  sprints: Array<{ id: number; name: string;
                   committedPoints: number; completedPoints: number;
                   completeDate: string | null }>;  // chronological (oldest→newest)
  averageCompleted: number;    // mean completedPoints
  forecastNext: number;        // heuristic capacity suggestion (= averageCompleted)
}
```
  When no matching closed sprints → `sprints: []`, `averageCompleted: 0`, `forecastNext: 0`
  (the UI shows an empty, encouraging state, not an error).

### 4.14 `get_leaves` / `set_leaves` (v1.5 — per-sprint leaves/offset tracker; ADR-016)

Real MCP tools backed by a **JSON file on the mcp-jira host** (`JIRA_LEAVES_FILE`, default
`<mcp-jira pkg>/.loopboard-leaves.json` — git-ignored). This is the project's first stateful
store (a deliberate, user-chosen exception to the stateless-bridge norm). File shape:
```jsonc
{ "<sprintId>": { "<assigneeName>": ["2026-06-03", "2026-06-04"], ... }, ... }
```
Helpers in `src/lib/leavesStore.ts`: `readLeaves(): LeavesFile`, `writeLeaves(LeavesFile)`
— read-modify-write with the file created on first write; tolerate a missing/corrupt file
(treat as `{}`). The path is read from config at call time so tests can point it at a temp
file. Dates are `YYYY-MM-DD` strings; values deduped + sorted.

- **`get_leaves`** — Input `{ sprintId: number }`. Output
  `{ sprintId: number, leaves: Record<string, string[]> }` (the assignee→dates map for that
  sprint; `{}` when none recorded).
- **`set_leaves`** — Input `{ sprintId: number, assignee: string (1–120), dates: string[] }`
  — each date zod-validated `YYYY-MM-DD`. **Behavior:** replace that assignee's leave dates
  for the sprint (empty `dates` clears the assignee). Read-modify-write the file. Output the
  updated `{ sprintId, leaves }` for that sprint.
- Both are registered MCP tools (stdio + `/api/tools` + bridge). Tests set
  `JIRA_LEAVES_FILE` to a temp path (or mock `fs`) and run keyless/offline; cover
  round-trip set→get, replace/clear, missing-file tolerance, date validation.

### 4.15 `get_assignable_users` / `assign_issue` (v1.7 — sprint-planning assignment; ADR-018)

Real MCP tools for assigning tickets to developers during planning. Jira Cloud assigns by
**accountId** (not name/email), so we list assignable users first.

```ts
export interface AssignableUser { accountId: string; displayName: string; active: boolean }
```

- **`get_assignable_users`** — Input `{ projectKey?: string, boardId?: number, maxResults?: number (default 50) }`.
  `projectKey` resolves: explicit `projectKey`; else if `boardId` equals the PO/Dev board id,
  the matching `JIRA_PO_PROJECT_KEY`/`JIRA_DEV_PROJECT_KEY`; else default `JIRA_DEV_PROJECT_KEY`.
  **Behavior:** `GET /rest/api/3/user/assignable/search?project={projectKey}&maxResults=...`.
  Map to `AssignableUser[]`, keep only `active === true`, sort by `displayName`.
  **Output:** `{ projectKey: string; users: AssignableUser[] }`.
- **`assign_issue` (WRITE)** — Input `{ ticketKey: string (same regex as §4.4), accountId: string | null }`
  (`null` unassigns). **Behavior:** `PUT /rest/api/3/issue/{ticketKey}/assignee` with
  `{ "accountId": <accountId|null> }` (Jira returns 204). A 404 → `UPSTREAM`
  `"Ticket <ticketKey> not found"`. **Output:** `{ ticketKey: string; accountId: string | null; assigned: boolean }`
  (`assigned` = `accountId !== null`).
- Both are registered MCP tools (stdio + `/api/tools` + bridge). Tests mock the Jira client;
  cover projectKey resolution, active-only filter + sort, assign + unassign (null), 404.
- **(v1.8 note, ADR-019):** `get_assignable_users` returns *everyone with the Assignable
  User permission* on the project (often org-wide) — NOT a team. The UI no longer uses it as
  the roster; it backs the optional add-by-name **search** only. The leaves plotter and the
  assignment dropdown use the curated **team roster** (§4.16). `assign_issue` is unchanged.

### 4.16 Team roster — `get_team_members` / `set_team_members` / `get_recent_assignees` (v1.8 — ADR-019)

Jira has no portable "team" primitive (assignable-search is permission-wide; project roles
and groups are instance-specific and need elevated perms). So we maintain a **curated team
roster per board**, **seeded from who's actually been assigned tickets in recent sprints**
("usual members"), editable (add/remove), persisted to a **bridge-side JSON file**
(`JIRA_TEAM_FILE`, default `<mcp-jira pkg>/.loopboard-team.json`, git-ignored — same store pattern
as leaves, §4.14). File shape: `{ "<boardId>": [ { "accountId": "...", "displayName": "..." }, … ] }`.
Helpers in `src/lib/teamStore.ts` (`readTeams()`/`writeTeams()`, missing/corrupt → `{}`).

```ts
export interface TeamMember { accountId: string; displayName: string }
```

- **`get_recent_assignees`** — Input `{ boardId?: number, withinDays?: number (default 90), maxResults?: number (default 200) }`.
  **Behavior (v1.9 — ADR-020):** scan the **whole board** (NOT a fixed number of sprints) for
  recently-assigned issues via `GET /rest/agile/1.0/board/{boardId}/issue` with
  `jql=assignee IS NOT EMPTY AND updated >= -{withinDays}d ORDER BY updated DESC`,
  `fields=assignee`, paging up to `maxResults` issues. Collect **distinct assignees** by
  `accountId` (skip null), counting how many of the scanned tickets each had. This covers the
  **active sprint + backlog + recently-closed work** — the prior v1.8 behavior sampled only the
  last 3 *closed* sprints and so missed anyone whose recent work was in the active sprint.
  **Output:** `{ boardId: number; assignees: Array<{ accountId: string; displayName: string; ticketCount: number }> }`
  sorted by `ticketCount` desc then `displayName`. This is the **suggestion source** for
  building/refreshing the team. Requires `IssueSummary.assigneeAccountId` (§4 type change).
  New jiraClient helper `getBoardAssigneesRaw(boardId, jql, maxResults)` (pages the board issue
  endpoint, returns `{ assignee, assigneeAccountId }[]`).
- **`get_team_members`** — Input `{ boardId?: number }` (default Dev board). **Output:**
  `{ boardId: number; members: TeamMember[] }` — the persisted roster for that board (`[]`
  when none saved yet). Sorted by `displayName`.
- **`set_team_members` (persist)** — Input `{ boardId?: number, members: Array<{ accountId: string (1+), displayName: string (1+) }> }`.
  **Behavior:** replace the board's roster with `members` (de-duped by `accountId`); empty
  array clears it. Read-modify-write the file. **Output:** `{ boardId: number; members: TeamMember[] }`.
  Add/remove in the UI = send the full updated list.
- All three are registered MCP tools (stdio + `/api/tools` + bridge). Tests point
  `JIRA_TEAM_FILE` at a temp path / mock the Jira client; keyless/offline; cover recent-assignee
  derivation (distinct + counts + sort, null-assignee skip), team round-trip set→get, replace/clear.

## 5. mcp-github tools (Phase 2) — exact IO

```ts
export interface PrSummary {
  number: number; title: string; author: string;
  branch: string; baseBranch: string;
  state: "open" | "closed" | "merged"; draft: boolean;
  url: string;                          // html_url
  jiraKeys: string[];                   // detected (§5.5)
}
```

**`state` derivation:** For a GitHub PR object, `state` is `"merged"` if `merged_at != null`
(regardless of GitHub's `state` field value), `"open"` if GitHub `state === "open"`,
`"closed"` if GitHub `state === "closed"` and `merged_at == null`.

### 5.1 `list_prs`
- **Input:** `{ repo?: string ("owner/name", default GITHUB_REPO), state?: "open" | "closed" | "all" (default "open") }`
  When `repo` is omitted and `GITHUB_REPO` is not set, return a `VALIDATION` error:
  `"repo is required when GITHUB_REPO env variable is not set"`.
- **Behavior:** `GET /repos/{owner}/{repo}/pulls?state={state}&per_page=50`.
  Apply `state` derivation above to each PR. When input `state` is `"open"`, pass
  `state=open` to GitHub (merged PRs will not appear). When `"closed"`, pass `state=closed`
  (both closed and merged PRs are returned; apply derivation). When `"all"`, pass
  `state=all`.
- **Output:** `{ repo: string; prs: PrSummary[] }`

### 5.2 `get_pr`
- **Input:** `{ repo?: string, number: number }`
  Same `repo` fallback and missing-repo error as §5.1.
- **Behavior:** `GET /repos/{owner}/{repo}/pulls/{number}`.
  A 404 from GitHub returns `UPSTREAM` error `"PR #<number> not found in <repo>"`.
- **Output:** `PrSummary & { body: string | null; mergeable: boolean | null; headSha: string }`

### 5.3 `link_pr_to_ticket`
- **Input:** `{ repo?: string, number: number, ticketKey?: string }`
  Same `repo` fallback and missing-repo error as §5.1.
  When `ticketKey` is omitted, auto-detect from the PR (§5.5). Zero detected keys →
  `VALIDATION` error: `"No Jira ticket key found in PR #<n>. Pass ticketKey explicitly."`.
- **Behavior:** for each ticket key:
  1. Jira remote link: `POST /rest/api/3/issue/{key}/remotelink` with
     `{ globalId: prUrl, object: { url: prUrl, title: "GitHub PR #<n>: <title>" } }`
     (`globalId` makes it idempotent — Jira upserts on globalId match).
  2. GitHub PR comment: First `GET /repos/{owner}/{repo}/issues/{number}/comments`.
     If no existing comment body contains the Jira browse URL for this key, post:
     `POST /repos/{owner}/{repo}/issues/{number}/comments`
     with body `"🔗 Linked to Jira: <browse url>"`.
     If a comment already contains the browse URL, set `commentPosted: false` (idempotent).
  Per-key failures are captured into `error` field, not thrown; other keys continue.
- **Output:**
  ```ts
  {
    prUrl: string;
    results: Array<{
      ticketKey: string;
      remoteLinkCreated: boolean;
      commentPosted: boolean;
      error?: string;
    }>;
  }
  ```

### 5.4 `sync_pr_links`
- **Input:** `{ repo?: string }` — same repo fallback and missing-repo error as §5.1.
- **Behavior:** list open PRs (`state: "open"`), auto-detect Jira keys for each,
  run §5.3 linking logic for each PR that has at least one detected key.
  PRs with zero detected keys go into `skipped` with `reason: "no Jira keys detected"`.
- **Output:**
  ```ts
  {
    repo: string;
    linked: Array<{ number: number; ticketKeys: string[] }>;
    skipped: Array<{ number: number; reason: string }>;
  }
  ```

### 5.5 Jira key detection (`src/lib/jiraKeys.ts`)
Regex `/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g` over PR **title + head branch name + body**
(concatenated with spaces; body may be null — treat null as empty string).
If `JIRA_PO_PROJECT_KEY` and/or `JIRA_DEV_PROJECT_KEY` are configured (non-empty),
keep only keys whose project prefix matches one of those values. If neither is configured,
keep all detected keys.
Dedupe, preserve first-seen order. Pure function, unit-tested. No side effects.

## 6. react-app

- `src/lib/mcpClient.ts` — typed client:
  ```ts
  export interface McpError { code: string; message: string; issues?: unknown[] }
  export function callTool<T>(
    server: "jira" | "github",
    name: string,
    input: unknown
  ): Promise<T>
  ```
  POSTs to the bridge at `VITE_MCP_JIRA_URL` or `VITE_MCP_GITHUB_URL` (defaulting to
  `http://localhost:4001` / `http://localhost:4002`), unwraps the `{ ok, data }` envelope,
  throws `McpError` on `ok: false`. On network failure (fetch throws), throw
  `McpError { code: "BRIDGE_DOWN", message: "Cannot reach <server> bridge — run: npm run dev" }`.
- `src/lib/aiClient.ts` (v1.1, +v1.4) — typed client for §4.9:
  ```ts
  export interface AiStatus { enabled: boolean; provider: string | null; model: string | null }
  export function getAiStatus(): Promise<AiStatus>           // GET jira /api/health → .ai (absent → disabled)
  export function aiDraftTickets(body: DraftRequest): Promise<DraftResponse>
  export function aiEnhanceTicket(body: EnhanceRequest): Promise<EnhanceResponse>
  export function aiSprintSummary(body: SprintSummaryRequest): Promise<SprintSummaryResponse>  // v1.4
  ```
  Same envelope/unwrap/error semantics as `mcpClient` (incl. `BRIDGE_DOWN`); an
  `ok: false` with code `AI_UNAVAILABLE` throws `McpError` with that code so callers can
  branch to the deterministic fallback / hide the AI summary.
- Hooks: `useMCP` (generic `{ data: T | null; error: McpError | null; loading: boolean; run: () => void }`),
  plus typed wrappers in `src/hooks/useJira.ts` (`useActiveSprint(boardId?, sprintId?)`,
  `useDailyHuddle(boardId?, sprintId?)`, `createTicketPair`, `enhanceTicket`, and v1.4:
  `createSprint`, `useSprintList(state?)`, `useSprintReport(sprintId)`,
  `useVelocity(beforeSprintId?)` (v1.5 — passes the selected sprint), v1.5:
  `useLeaves(sprintId)`, and v1.8: `useTeamMembers(boardId?)`, `useRecentAssignees(boardId?)`,
  `saveTeamMembers(boardId, members)`) and `src/hooks/useGithub.ts` (`usePrs`, `linkPr`).
- **Board context (v1.6, ADR-017):** `src/lib/boards.ts` — `getBoards(): Promise<{ dev, po }>`
  reads `GET /api/health` (jira) `.boards`; a `useBoards()` hook (or a tiny context) exposes
  them. A **Board toggle** (a small segmented control / `<select>` "Board: Dev / PO") appears
  on the **Dashboard** and the **Reports** page, defaulting to **Dev**. The selected board's
  numeric `id` is passed as the `boardId` to every board-scoped call on that page
  (`get_active_sprint`, `get_daily_huddle`, `list_sprints`, `get_sprint_report`,
  `get_velocity`, `create_sprint`). Changing the board resets sprint selection + filters and
  refetches. If `boards` is absent from health (older bridge), hide the toggle and behave as
  Dev-only. A board with **no active/future sprints** (e.g. a Kanban PO board) shows a
  friendly empty state ("No sprints on the PO board"), not a hard error — map the
  `UPSTREAM`/"No active or future sprint" case to that empty state.
- **Tab nav (v1.7, ADR-018):** **Dashboard · Planning · Reports**. The old "Ticket
  Generator" tab is REMOVED — its functionality moves into **Planning** (below). Dashboard
  and Reports keep their tabs.
- Pages (react-router not required — a simple state-based tab nav is fine):
  - **Planning (v1.7, ADR-018) — the sprint-preparation / grooming workspace.** A
    board-and-sprint-scoped page that consolidates the prep actions:
    - **Board + sprint context:** a Board toggle (Dev/PO, from `useBoards`, default Dev) and
      a sprint picker (from `list_sprints` active+future on the selected board). **Default
      target = the next future sprint** (first of `futureSprints`); if none, the active
      sprint. Changing board re-defaults the target.
    - **New Sprint (moved from Dashboard):** the `CreateSprintDialog` lives here (creates a
      future sprint on the selected board → selects it as the planning target). It is
      REMOVED from the Dashboard.
    - **Ticket generation (moved from the Ticket Generator tab):** the full TicketGen
      experience (AI chat + fallback templates + "Use AI drafting" + editable PO/Dev draft
      previews + create) is embedded here, reusing the existing component. The **target
      sprints pre-seed from the planning context** — the current board's planned sprint is
      pre-selected for that board's ticket (PO planned sprint → PO Story, Dev planned sprint
      → Dev Task), still overridable via the two sprint selects (v1.6). All prior TicketGen
      behavior is preserved.
    - **Team roster (v1.8, ADR-019) — the source of truth for who appears.** Both the leaves
      plotter and the assignment dropdown roster from the **curated per-board team**
      (`useTeamMembers(boardId)`), NOT the org-wide assignable list. A **"Manage team"**
      control (button → dialog, or an inline editor) shows the current roster with **remove**
      buttons and TWO add affordances: (a) **"Add from recent activity"** — calls
      `get_recent_assignees` (the "usual members" — distinct assignees recently assigned across
      the **whole board**, incl. the active sprint, with ticket counts) for one-click / per-person
      add; and (b) **"Search all people" (v1.9, ADR-020)** — a search box over the **full**
      assignable list (`useAssignableUsers(boardId)` → `get_assignable_users`), filtered
      client-side by name, so ANY person can be added even if they have no recent tickets (the
      recent list is no longer a ceiling). Already-on-team people are marked in both lists.
      Changes persist via `set_team_members(boardId, members)`. **First-run (empty roster):** a clear
      "Set up your team — add the usual members from recent activity" prompt that one-click
      seeds from `get_recent_assignees`. The roster is keyed by board (Dev vs PO teams differ).
    - **Leaves / capacity plotting (moved from Reports, v1.5/ADR-016):** the editable leaves
      calendar for the planned sprint, **rostered from the curated team** (`useTeamMembers`) —
      plot leaves for any team member regardless of current sprint assignment (key for a
      near-empty future sprint). Persists via `set_leaves`/`get_leaves`. Shows the
      capacity-adjusted "possible committed velocity" (`capacity.ts` + the board's
      `get_velocity` average). The **Reports** page ALSO has an **editable** leaves calendar
      (v1.8.1 — user request) for its selected sprint, rostered from that sprint's assignees;
      both pages persist to the same `set_leaves`/`get_leaves` store keyed by sprintId.
    - **Assign tickets to developers (NEW, v1.7; v1.8 roster fix):** a list of the planned
      sprint's tickets (from `get_active_sprint(boardId, sprintId)` across all buckets). Each
      row: ticket (key→Jira link, summary, points, current assignee initials) + an **assignee
      `<select>`** populated from the **curated team** (`useTeamMembers`) + "Unassigned".
      Pre-select the current assignee by `assigneeAccountId`. **v1.9 (ADR-020) — no off-team
      restriction:** if the current assignee is not in the team, include them as a **normal,
      selectable** option (their plain display name) so the assignment is preserved AND can be
      re-selected — the prior disabled "(not on team)" lock is removed (user request). The
      dropdown is still **Unassigned + curated team** (+ the current off-team assignee when
      present); it does NOT list the org-wide roster (use "Manage team → Search all people" to
      add someone first). Changing it calls `assign_issue(ticketKey, accountId|null)`
      (optimistic; refetch on success; inline per-row error, non-blocking). A future sprint with
      no tickets → "Add tickets above, then assign them". An **empty team** → a note pointing to
      "Manage team".
    - New `src/hooks`/`src/lib`: `teamClient.ts` (`getTeamMembers`/`setTeamMembers`/
      `getRecentAssignees`), `useTeamMembers(boardId)`, `useRecentAssignees(boardId)`; a
      `TeamManager` component. `useAssignableUsers` powers the v1.9 **"Search all people"**
      add box in TeamManager. Reuse `useLeaves`, `capacity.ts`, `useActiveSprint`. a11y + states.
  - **Dashboard** — owns `selectedBoardId` (v1.6, default = `boards.dev.id`),
    `selectedSprintId: number | null` state (v1.1), and `assigneeFilter: string | null`
    state (v1.2). `SprintBoard` + a sidebar that stacks **`ChatPanel` on top, then
    `HuddleDigest`** (v1.3.1). The Board toggle sits in the header; switching boards shows
    that board's sprint board / huddle / sprint selector (all scoped to the selected board).
    **(v1.7: the "New Sprint" button is REMOVED from the Dashboard — it now lives on the
    Planning page.)**
    **Sprint selector (v1.1, +v1.4 future sprints):** the SprintBoard header shows a
    labeled `<select>` ("Sprint") with the active sprints (latest first) and, in a separate
    optgroup/section labeled **"Future"**, the `futureSprints` (next-up first); selected =
    `sprint.id`. Changing it sets `selectedSprintId` and BOTH the board and the huddle
    refetch with that `sprintId`. The selector is shown when there is more than one
    selectable sprint (active + future combined > 1). When a **future** sprint is selected
    (`sprint.state === "future"`), show a small "Future sprint" badge and a friendly empty
    note when it has no issues yet (planning view). Selecting a future sprint resets the
    assignee filter like any sprint change.
    **Create Sprint (v1.4, ADR-011):** a "New Sprint" button near the selector opens a
    dialog (shadcn Dialog/AlertDialog) with fields: name (required), goal (textarea),
    start date, end date (`<input type="date">`; client validates start < end). On submit
    it calls the `create_sprint` tool → on success closes, refetches the board, and selects
    the new sprint (it appears under "Future"). Surfaces `UPSTREAM`/`VALIDATION` errors
    inline. The dialog copy makes clear this creates a REAL sprint on the Jira board. (AI
    goal-draft is an optional stretch, not required.)
  - **SprintBoard columns (v1.2):** FOUR columns in this order — **To Do**
    (`issuesByStatus.todo`), **In Progress** (`issuesByStatus.inprogress`),
    **Code Review** (`issuesByStatus.codereview`), **Done** (`issuesByStatus.done`).
    Each column header shows its count. Blocked issues keep their red badge in whatever
    column they fall in. Sprint header still shows name/dates/goal and story-point totals
    (done/total). Responsive: the 4 columns collapse to fewer/one ≤ 768px (horizontal
    scroll or stack — implementer's choice, must stay usable at 360px).
  - **Assignee filter (v1.2):** the Dashboard derives the distinct assignee list from the
    loaded sprint issues (across all four buckets; `null` assignee → an "Unassigned"
    option). A filter control in the SprintBoard header (chips or a `<select>` labeled
    "Assignee") offers **All** (default), each distinct assignee (display name), and
    **Unassigned** when any unassigned issue exists. Selecting one filters the rendered
    issue cards in ALL four columns to that assignee **client-side** (no refetch; the tool
    output is unchanged). Column counts update to reflect the filtered view, with the
    sprint header showing "Showing X of Y issues" when a filter is active. The HuddleDigest
    is NOT filtered (it's a whole-sprint standup digest). "All" clears the filter. The
    filter resets to "All" when the sprint selection changes. Purely presentational — the
    assignee data already lives in `IssueSummary.assignee`; no contract/tool change.
  - **TicketGen component (v1.1 — AI chat with deterministic fallback).** **(v1.7: this is
    no longer a standalone tab — the component is reused INSIDE the Planning page, ADR-018.
    All behavior below is preserved; it now mounts within Planning with its target sprints
    pre-seeded from the planning context.)** On mount, `getAiStatus()`.
    - **AI mode** (`ai.enabled`): chat-style page — message thread (user + assistant
      bubbles), input for the feature description and follow-ups, optional story-points
      field. Each send POSTs the FULL conversation to `aiDraftTickets`; renders
      `assistantMessage` as the assistant bubble and the returned PO/Dev drafts as the
      EXISTING editable preview cards (summary input + description textarea). Follow-up
      messages refine: previous drafts are replaced by the new response. "Create in Jira"
      calls `create_po_ticket` then `create_dev_ticket` (with `linkedPoTicketKey`) →
      success panel with keys + URLs. A small badge shows provider/model. AI call
      failures (502/500) render in-thread with a "use local templates instead" action.
    - **Fallback mode** (`ai.enabled === false`, or health says AI off, or
      `AI_UNAVAILABLE`): the existing v1.0 deterministic form flow
      (`ticketTemplates.ts`), with a dismissible banner: "AI drafting is off — using
      local templates. Set AI_PROVIDER in .env to enable (docs/SETUP.md)."
    - **Switch back to AI (v1.2 — fixes the one-way trap):** whenever TicketGen is in
      fallback mode but AI is actually available, the page shows a **"Use AI drafting"**
      button (in the banner and/or page header). It clears any local `forceFallback`
      state, re-checks `getAiStatus()`, and — if AI is enabled — returns to AI chat mode
      (seeding the thread with the current feature-description text if present). If the
      re-check still reports AI off, it shows the disabled banner explaining `AI_PROVIDER`
      is unset (no console error). The fallback must therefore distinguish "AI genuinely
      disabled" (no toggle, just the enable-instructions banner) from "user/error switched
      to local" (show the "Use AI drafting" button).
    - **Target sprints — separate PO and Dev (v1.4 base; v1.6 split, ADR-017):** TicketGen
      offers **two** optional "Add to sprint" `<select>`s — a **PO sprint** (populated from
      `list_sprints` active+future on `boards.po.id`) for the PO Story, and a **Dev sprint**
      (from `list_sprints` on `boards.dev.id`) for the Dev Task; each defaults to
      "Backlog / no sprint". On "Create in Jira" the PO `sprintId` is passed to
      `create_po_ticket` and the Dev `sprintId` to `create_dev_ticket` (the pair stays
      linked via `linkedPoTicketKey`) — so the linked PO+Dev tickets land in their
      respective boards' sprints at once. The success panel notes each target sprint and
      surfaces any `sprintWarning` per ticket (non-fatal). Works in AI and fallback modes.
      If health has no `boards`, fall back to the single Dev "Add to sprint" select (v1.4).
  - **Reports (v1.4 — Phase 3; ADR-012. v1.4.1 — UI-expert layout + story-points focus)** —
    a real reporting page (replaces the stub):
    - **Layout (v1.5, ADR-016 — supersedes the v1.4.1 single-column):** NOT a simple
      vertical column AND not the old cramped flex-row — a **full-width responsive grid**
      that maximizes available width (remove the narrow `max-w` constraint; the report
      spans the page). A UI-expert designs a multi-column dashboard arrangement that reads
      well: e.g. at wide widths the completion summary + velocity sit in a top row, the
      leaves calendar + by-assignee in the next, with the issue lists and AI summary
      full-width below — collapsing to one column ≤ md. Strong hierarchy, generous
      whitespace, soft-UI; usable at 360px; clean print. Update `docs/REPORTS-LAYOUT.md`
      with the new full-width rationale.
    - **STORY-POINTS FOCUS (v1.4.1):** the report is about **story points, not issue
      counts.** Show committed points, completed points, `completionRate` (points-based)
      as a progress bar, and **carryover points** (= committed − completed). Do NOT show
      "issues done/total" as a metric, and the **By assignee** table shows **only points**
      (name, done points, total points) — drop the done-issues / total-issues columns.
      Blocked may remain as a small risk flag (count is acceptable there — it's an
      impediment signal, not a velocity metric) or be omitted. The issue **lists**
      (Completed / Carryover) still list individual issues with their points. (Note: with
      the v1.5 DoD, `completedPoints` already counts code-review as done — §4.12/ADR-014.)
    - **Decimal formatting (v1.4.1):** ALL point values (committed, completed, carryover,
      per-assignee, velocity averages/forecast, per-sprint bars) render with **at most 2
      decimals, trailing zeros trimmed** (e.g. `13.5`, `29.75`, `30`, not `13.50` /
      `29.7500000`). Use a shared `formatPoints(n)` helper (pure, tested). This replaces
      the velocity `.toFixed(1)`.
    - **Board toggle — separate PO & Dev reports (v1.6, ADR-017):** a "Board: Dev / PO"
      toggle at the top of Reports (from `boards`, default Dev). The sprint picker and ALL
      report tools (`list_sprints`, `get_sprint_report`, `get_velocity`, leaves) use the
      selected board's `id`, so PO and Dev reports are fully separate. Switching boards
      resets the selected sprint. A board with no sprints shows the empty state.
    - **Per-sprint report** (`get_sprint_report`): header (name, dates, goal, state badge);
      the points-focused completion summary above; a **By assignee** points table; a
      **Completed** list and a **Carryover / not completed** list (each issue: key→Jira
      link, summary, assignee, points; blocked flagged). Loading/error/empty states.
    - **Velocity + forecast** (`get_velocity`, v1.5 selected-sprint context): a CSS bar
      chart (no charting dep) of the closed sprints **before the selected sprint** —
      `useVelocity` passes the selected sprintId as `beforeSprintId`, so the chart is "the
      N sprints prior to the one you're viewing" and refetches on sprint change. Committed
      vs completed points per sprint (via `formatPoints`) + `averageCompleted` +
      `forecastNext`, labeled "suggested capacity (avg of last N before this sprint), not a
      commitment". Empty state when none.
    - **Leaves / team calendar (v1.5, ADR-016; v1.8.1 — EDITABLE on Reports again):** the
      Planning page is the primary plotter (team-rostered), but **Reports also has an
      editable leaves calendar** for its selected sprint (user request — reverses the v1.7
      read-only) rostered from that sprint's assignees (`report.byAssignee`); plus the
      by-assignee **Leaves** column + capacity figures. Both pages persist to the same
      `set_leaves`/`get_leaves` store keyed by sprintId (`LeavesCalendarCard` without
      `readOnly`). When no leaves are recorded, the Leaves column shows 0 and capacity = the
      raw average.
    - **Capacity-adjusted "possible committed velocity" (v1.5, ADR-016):** a PURE helper
      `src/lib/capacity.ts` computes, from the selected sprint's working days, its assignees,
      and the entered leaves: `totalPersonDays = assignees × sprintWorkingDays`,
      `availablePersonDays = totalPersonDays − Σ leaveDays`,
      `capacityFactor = available / total` (1 when total 0), and
      `possibleCommitted = averageCompleted × capacityFactor` (via `formatPoints`).
      Display it NEXT TO the raw forecast, clearly labeled a heuristic ("possible committed
      velocity for this sprint, adjusting the average for entered leaves — not a
      commitment"), with the inputs shown (e.g. "N people · W working days · L leave days →
      X% capacity"). Unit-tested.
    - **By-assignee leaves column (v1.5):** the By-assignee table gains a **Leaves** column
      (days off this sprint, from `get_leaves`) alongside the points columns.
    - **AI executive summary** (optional): when AI is enabled (`getAiStatus`), a "Draft
      summary" button calls `aiSprintSummary` with the report payload and renders the
      returned narrative (markdown). Hidden/disabled with a hint when AI is off; AI errors
      render inline without breaking the data report.
    - **Export:** an export bar — **Copy** (report as Markdown to clipboard), **Download
      .md** (Blob download), and **Print / Save as PDF** (a print-optimized layout via
      `window.print()` + a scoped `@media print` stylesheet — dependency-free; the AI
      summary, when present, is included). The Markdown builder is a PURE function
      (`src/lib/reportMarkdown.ts`), unit-tested.
- **ChatPanel** — deterministic command router (`src/lib/chatRouter.ts`, pure +
  unit-tested). Commands: `help`, `huddle`, `sprint`, `ticket <KEY>`,
  `enhance <KEY> <notes>`, `create <description>`, `prs`, `link pr <n> [KEY]`.
  Unknown input → help text explaining the POC scope and pointing to Copilot for free-form
  NL (spec §8 decision). Responses render as message cards (ticket cards, sprint summary,
  huddle digest...). **v1.1 AI routing:** when AI is enabled, `create <description>`
  obtains its PO/Dev drafts from `aiDraftTickets` (single user message) before calling the
  create tools, and `enhance <KEY> <notes>` flows `get_ticket` → `aiEnhanceTicket` →
  `update_ticket`; the assistant card shows `assistantMessage`. When AI is disabled or
  returns `AI_UNAVAILABLE`, both commands fall back to the v1.0 deterministic behavior
  (templates / notes-merge) and say so in the reply card. `sprint` and `huddle` commands
  respect the Dashboard's selected sprint. The `sprint` command result reflects the active
  assignee filter when one is set; `huddle` is never filtered.
- All data components handle **loading / error / empty** states; bridge-down errors show
  the start command.
- **UI stack (v1.2 — supersedes the v1.0 "no framework" rule; ADR-009):** the app uses
  **Tailwind CSS + shadcn/ui** (Radix primitives). shadcn components live under
  `src/components/ui/`, generated via the shadcn CLI; only components actually used are
  added. The `@/` path alias resolves to `src/` (wired in `vite.config.ts` +
  `tsconfig.json`). The prior token set maps onto shadcn's CSS theme variables so the
  palette stays coherent (indigo accent, status colors). Behavior, props, event handlers,
  state, and every contract above are PRESERVED through the migration — it is a
  presentation-layer change. Professional dashboard look, modern/minimal, responsive
  ≥ 360px, WCAG AA contrast, visible focus rings, hover + loading affordances. Existing
  RTL tests stay green; tests are updated only where the DOM legitimately changed (prefer
  role/label queries; never weaken a behavioral assertion).

### 6.1 Design system + Scrum affordances (v1.3 — ADR-010)

A two-specialist (UI/UX + Scrum Master) live review. All items below are **react-app
presentation/derivation only** — they use data ALREADY in the tool outputs; NO MCP tool,
HTTP, or env contract changes. lucide-react (already a dependency) provides icons. Tests
stay keyless/offline; update RTL tests only where the DOM legitimately changed, never
weakening a behavioral assertion. EXACT contract-critical copy (bridge-down commands, AI
banner text, "Showing X of Y issues", "Use AI drafting", help/command text) is preserved.

**Design tokens (src/globals.css + tailwind.config):** a refined token set on shadcn CSS
variables — primary indigo `hsl(243 75% 59%)`; slate neutral ramp; accent violet
`hsl(258 90% 66%)` (AI / code review); semantic `success hsl(142 71% 45%)`,
`warning hsl(38 92% 50%)`, `error hsl(0 72% 51%)`, `info hsl(217 91% 60%)`, EACH with a
`-bg` (~12% tint) and `-foreground`/`-border` token (replace the ad-hoc green-50/amber-50
literals). Add a `.dark` variable block (no toggle UI required this round). Status colors
(todo slate / inprogress blue / codereview violet / done emerald / blocked red) become a
named token group used by the column headers and badges. Standardize radius (`rounded-lg`
cards, `rounded-md` controls), `shadow-sm` max, a 4px spacing scale, a typographic scale
(page/sprint title `text-2xl font-semibold`; column header `text-xs font-medium uppercase
tracking-wide text-muted-foreground`; meta `text-xs`; keys `font-mono`), and 150ms
color/transform transitions guarded by `prefers-reduced-motion`. **Typeface (v1.3.1):
Poppins**, self-hosted via `@fontsource/poppins` (weights 400/500/600/700 imported in
`main.tsx`), set as Tailwind `fontFamily.sans` and applied to `body` via `font-sans` —
offline-safe, no external font request.

**SprintBoard — sprint header (3 zones):** identity (sprint name dominant + date range,
calendar icon) · progress · controls (sprint + assignee selects, label-above, `h-9`,
focus ring; sprint option label shortened e.g. `Arsenic · Jun 4–17` with full name in a
`title`/tooltip). Column headers become filled tinted bands with a lucide icon + a colored
count badge per status.

**Sprint progress + pace (derive from `totals` + `sprint` dates):**
- Progress bar (v1.5 DoD, ADR-014): completed points = `storyPointsDone +
  storyPointsCodeReview` (code review counts as done for progress/pace; the board still
  shows Code Review as its own column). Bar = completed / `storyPointsTotal`.
  When `storyPointsTotal === 0`, show "No estimates" rather than a 0% bar. The pace chip
  uses the same DoD-completed points.
- Sprint timeline (from `sprint.startDate`/`endDate`, client clock): `Day X of N · M days
  left` + a thin elapsed bar. Handle null dates gracefully (hide the timeline).
- **Pace indicator (heuristic, clearly labeled — NOT a forecast):** compare % sprint time
  elapsed vs % story points done → `On track` (within ~10%), `Behind`, or `Ahead`, as a
  small semantic chip. If no estimates or no dates, omit. Pure function, unit-tested.

**Blocker affordance:** when `totals.blocked > 0`, a `warning`/`error` Alert above the
board: "⚠ N blocked — KEY1, KEY2…" (lists up to ~5 keys, linking to Jira) + a one-click
"Show blocked" toggle that filters all columns to blocked issues (composes with the
assignee filter). Hidden when 0 blocked.

**"My issues" quick filter — REMOVED (v1.4.1, ADR-013).** Per user feedback the remembered
"My Issues" toggle (and its `localStorage` key) is removed from the Dashboard sprint filter.
The plain **Assignee `<select>`** (All / each name / Unassigned) stays as the filter. The
initials-avatar chips next to assignee names may remain (they are independent of the
removed toggle).

**Huddle digest — "By status / By person" toggle:** a control on `HuddleDigest` switching
the grouping of the SAME `get_daily_huddle` data between the current status sections and a
per-assignee view (each person's inProgress + codeReview + blocked items) for a
walk-by-person standup. **Default view = By person (v1.3.1)** — the standup walk is the
primary use; "By status" remains one click away. `summaryText` and the copy-to-clipboard
output are unchanged in "By status"; in "By person" the clipboard text groups by person.
Pure client regroup.

**Reports page:** keep the Phase 3 stub but add clearly-labeled, **disabled** "Velocity"
and "Burndown" placeholders explaining they need historical sprint data (Phase 3) — do
NOT fabricate numbers.

**Out of scope (Phase 3 — needs historical/persisted data, do not fake):** velocity
average, burndown chart, retro board, sprint report generator.

## 7. Quality gates (every package)

- `npm run typecheck`, `npm run build`, `npm run test` all pass **with no `.env` and no
  network** (vitest; mock axios via `vi.mock`).
- zod-validate every tool input. No `any` (use `unknown` + narrowing). Never log secrets.
- Tests live in `test/` (servers) or `src/**/*.test.tsx` (react-app).

---

## Changelog (from DRAFT to FINAL)

Changes made by the Architect agent during finalization:

1. **Header** — changed from `DRAFT` to `FINAL — AUTHORITATIVE`; updated tiebreak rule
   (this document supersedes the spec on implementation details, not the other way around).

2. **§1.1 — stdio adapter error handling** — added normative rule: handler errors are
   caught and returned as `{ content: [...], isError: true }` MCP frames; errors must not
   be rethrown or written to stdout.

3. **§2 — `GET /api/health` version field** — specified it must be read from the package's
   own `package.json` at startup; must not be hardcoded.

4. **§2 — `GET /api/tools` response type** — changed `[{ name, description }]` (ambiguous
   tuple/object notation) to explicit `Array<{ name: string; description: string }>`.

5. **§3 — Required/Default contradiction** — separated "yes (no default)" from "optional"
   in the Required column; `JIRA_PO_PROJECT_KEY`/`JIRA_DEV_PROJECT_KEY` corrected to
   "optional" with defaults `"PO"`/`"DEV"` (they had "yes" but also showed defaults —
   contradictory). Added explanatory note on what "required" means at startup.

6. **§3 — `GITHUB_REPO` missing-variable behavior** — specified that if both the call-site
   `repo` parameter and `GITHUB_REPO` env var are absent, return a `VALIDATION` error
   (not a startup `CONFIG` error, since it is declared optional).

7. **§4.2 — `create_dev_ticket` output type** — replaced ambiguous inline-extension
   notation with explicit type comment; added `issueLink` payload shape so the implementer
   does not have to guess the Jira API body format.

8. **§4.3 — `get_active_sprint` — multiple active sprints** — added normative rule:
   use `values[0]`; specified `boardId` integer coercion from env var string.

9. **§4.3 — `get_active_sprint` totals** — clarified `storyPointsTotal` counts null story
   points as 0; clarified `blocked` counts all blocked issues regardless of status bucket.

10. **§4.3 — `startDate`/`endDate`/`goal` nullability** — added explicit note: `null` when
    absent in Jira response.

11. **§4.4 — `get_ticket` input validation** — added zod `.regex()` pattern for
    `ticketKey`; added 404 → `UPSTREAM` error specification.

12. **§4.4 — `created`/`updated` field format** — specified ISO 8601 pass-through from
    Jira fields; no reformatting.

13. **§4.5 — `update_ticket` PUT payload shape** — added explicit `{ fields: {...} }` body
    structure; added `updatedFields` content specification (`"summary"`, `"description"`);
    added 204/404 Jira response handling.

14. **§4.6 — `get_daily_huddle` bucket classification** — added explicit "done always wins"
    rule; added `summaryText` format template so all implementers produce identical output.

15. **§5.1/5.2/5.3/5.4 — `repo` missing-variable error** — propagated the
    call-time `VALIDATION` error rule to all four GitHub tools for consistency.

16. **§5.1 — `state` derivation** — added a normative `state` derivation rule (merged
    detection from `merged_at`) and specified how each input `state` value maps to the
    GitHub API `state` query parameter.

17. **§5.2 — `get_pr` not-found error** — added 404 → `UPSTREAM` error specification.

18. **§5.3 — `link_pr_to_ticket` output type** — changed tuple literal `[{ ... }]`
    notation to `Array<{ ... }>` to avoid TypeScript tuple misinterpretation.

19. **§5.4 — `sync_pr_links` output type** — same tuple→Array fix; added explicit
    `reason` value for the no-keys-detected skipped case.

20. **§5.5 — `jiraKeys.ts` null body handling** — specified that a null PR body is
    treated as empty string (prevents runtime TypeError on spread).

21. **§6 — `McpError` shape** — promoted `McpError` interface definition into the contract
    (was implicit); added `issues?: unknown[]` to match the HTTP error envelope.

22. **§6 — `useMCP` hook signature** — made explicit in the contract; previously
    implied but not typed.

23. **§6 — hook file paths** — corrected to `src/hooks/useJira.ts` / `src/hooks/useGithub.ts`
    (the spec §5 repo layout shows `hooks/` under `src/`; the draft had no path prefix).

---

## Changelog v1.1 (2026-06-11 — user-directed scope change after live testing)

24. **§4.3 — multiple active sprints** — the v1.0 `values[0]` rule selected the OLDEST
    active sprint on boards running several; replaced with: list ALL active sprints,
    sort latest-first by `startDate` (nulls last, ties by id desc), default-select the
    latest, allow explicit `sprintId`; added `ActiveSprintRef` and `activeSprints` to the
    output. ADR-007.

25. **§4.6 — `get_daily_huddle`** — gains `sprintId?` input (same selection rule) and
    `sprintId` in output.

26. **§4.9 (new) — AI drafting endpoints** — `POST /api/ai/draft-tickets` and
    `POST /api/ai/enhance-ticket` on the mcp-jira bridge only; dual provider behind
    `AiProvider` port (`anthropic` via official SDK + structured outputs, `github` via
    GitHub Models REST), switched by `AI_PROVIDER`; new `AI_UNAVAILABLE` 503 code;
    `/api/health` (jira) gains `ai` status. Amends ADR-002 — see ADR-006. Keys stay
    server-side; keyless/offline test gates unchanged.

27. **§3 — env table** — added `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
    (default `claude-opus-4-8`), `GITHUB_MODELS_TOKEN` (falls back to `GITHUB_TOKEN`),
    `GITHUB_MODELS_MODEL` (default `openai/gpt-4o-mini`), `GITHUB_MODELS_BASE_URL`.

28. **§6 — react-app v1.1** — sprint selector dropdown on the Dashboard (board + huddle
    follow the selection); TicketGen becomes an AI chat with the v1.0 deterministic form
    as explicit fallback; ChatPanel `create`/`enhance` route through the AI endpoints when
    enabled; new `aiClient.ts`; hooks gain `sprintId` parameters.

29. **Dependency note** — `@anthropic-ai/sdk@^0.104.1` added to mcp-jira; zod resolved at
    3.25.76 (AI schemas import from the `zod/v4` subpath; all other code stays on `"zod"`
    v3 API).

---

## Changelog v1.2 (2026-06-11 — user-directed, after further live testing)

30. **§4.3 / §4.6 — Code Review bucket** — boards have a distinct "Code Review" status
    that was being lumped into In Progress. Added env-configurable code-review detection
    (`JIRA_CODE_REVIEW_STATUSES`, default `code review,in review,peer review,review`),
    guarded to `statusCategory === "inprogress"` so done/todo statuses never move. Added
    `issuesByStatus.codereview` + `totals.codereview` to `get_active_sprint`,
    `codeReview` bucket to `get_daily_huddle` (precedence done > blocked > codeReview >
    inProgress > upNext), and the new `summaryText` "<n> in code review" segment.
    `IssueSummary` is unchanged (bucketing only). ADR-008.

31. **§6 — SprintBoard four columns** — To Do / In Progress / Code Review / Done, each
    with a count; blocked badge preserved per column.

32. **§6 — Assignee filter** — Dashboard derives the distinct-assignee list (incl.
    "Unassigned") from loaded sprint issues; a header control filters all four columns
    **client-side** to one assignee ("All" default, "Showing X of Y" when active, resets
    on sprint change); HuddleDigest is never filtered. Presentational — no tool change.
    ADR-008.

33. **§6 — TicketGen "Use AI drafting" toggle** — fixes the v1.1 one-way trap where
    switching to local templates had no path back. Fallback now distinguishes "AI
    genuinely disabled" (instructions banner only) from "switched to local" (shows a
    "Use AI drafting" button that re-checks `getAiStatus()` and returns to AI mode).

34. **§6 — UI stack change: Tailwind CSS + shadcn/ui** — supersedes the v1.0 "no
    framework, hand-rolled CSS" rule. Presentation-layer migration: components move to
    `src/components/ui/` (shadcn/Radix), `@/`→`src/` alias added to `vite.config.ts` +
    `tsconfig.json`, prior tokens mapped to shadcn theme variables. All behavior, props,
    state, contracts, and keyless/offline test gates preserved; tests updated only where
    the DOM legitimately changed. Two-phase delivery (component migration, then a
    modernization audit/pass). ADR-009. **`react-app` `package.json`/`tsconfig`/
    `vite.config.ts` are unfrozen for this change** (the only round that touches them).

---

## Changelog v1.3 (2026-06-12 — user-directed two-specialist UI + Scrum review)

35. **§6.1 (new) — Design system + Scrum affordances** — refined semantic token set
    (success/warning/error/info + `-bg`/`-border`, slate neutrals, `.dark` block, status
    token group), typographic scale, radius/shadow/spacing standards, lucide iconography,
    motion (reduced-motion safe). Scrum affordances derived from EXISTING tool data:
    sprint progress bar, days-remaining timeline, pace heuristic chip, blocker banner +
    "Show blocked" filter, "My issues" remembered quick filter + initials avatars, huddle
    "By status / By person" toggle, Reports velocity/burndown placeholders (disabled,
    labeled Phase 3). ADR-010. **react-app presentation/derivation ONLY — no MCP tool,
    HTTP, or env contract change**; velocity/burndown/retro remain Phase 3 (not faked).

---

## Changelog v1.3.1 (2026-06-12 — user-directed small UI tweaks)

36. **Typeface → Poppins** — self-hosted via `@fontsource/poppins` (400/500/600/700),
    Tailwind `fontFamily.sans` + `body @apply font-sans`. Offline-safe; presentation only.
37. **Huddle default view = By person** — the standup-walk grouping is now the initial
    `HuddleDigest` view ("By status" one click away). Status-section RTL tests now select
    "By status" explicitly (it is no longer the default); behavioral assertions unchanged.
38. **Dashboard sidebar order** — `ChatPanel` (sprint commands) renders ABOVE
    `HuddleDigest`.

---

## Changelog v1.4 (2026-06-12 — user-directed: sprint management + Phase 3 reports)

39. **§4.3 — future sprints** — `get_active_sprint` fetches `state=active,future`, returns
    `futureSprints[]` (earliest-first) alongside `activeSprints[]`, and `sprintId` may now
    select an active OR future sprint (default still latest active; falls back to next
    future when no active). ADR-011.
40. **§4.1/§4.2 — optional `sprintId` on ticket creation** — new tickets can be dropped into
    a chosen sprint via the shared add-to-sprint helper (`POST .../sprint/{id}/issue`),
    non-fatal (`sprintWarning`). ADR-011.
41. **§4.10 `create_sprint` (new WRITE tool)** — `POST /rest/agile/1.0/sprint` with
    name/goal/dates → future sprint. A real MCP tool (Copilot can create sprints) + bridge.
42. **§4.11 `list_sprints` (new)** — active/future/closed `SprintRef[]` for the sprint
    pickers, target-sprint dropdown, and reports/velocity.
43. **§4.12 `get_sprint_report` (new)** + **§4.13 `get_velocity` (new)** — Phase 3 report
    data: committed/completed points, completed vs carryover, by-assignee, blockers; and
    real velocity over the last `JIRA_VELOCITY_SPRINTS` (default 6) closed sprints + a
    heuristic next-sprint forecast (no longer the ADR-010 placeholder). ADR-012.
44. **§4.9 — `POST /api/ai/sprint-summary`** — optional AI executive summary of a sprint
    report (bridge-only, dual-provider, 503 `AI_UNAVAILABLE` when off).
45. **§3 — env** — added `JIRA_VELOCITY_SPRINTS` (default 6).
46. **§6 — react-app** — sprint selector adds a Future optgroup + "Future sprint" badge +
    "New Sprint" create dialog; TicketGen gets an optional "Add to sprint" target;
    **Reports page is now real** (per-sprint report + velocity/forecast bars + AI summary +
    Copy/Markdown/Print-PDF export; `reportMarkdown.ts` pure + tested). ADR-011/012.

47. **HOTFIX (live-testing) — Jira sprint pagination** — the board sprint endpoint
    paginates at 50; `getActiveSprints`/`getActiveAndFutureSprints`/`getSprintsByState`
    fetched only the first page, so boards with >50 sprints truncated. On the real board
    (78 sprints) this hid the 2 **future** sprints entirely and undercounted active (4 vs
    30). Added `fetchAllSprintsRaw` (follows `startAt`/`isLast`, stops on a short page) and
    routed all three through it. Caught by live verification; smoke `/api/tools` count
    updated to 10 (the 4 new tools) + create_sprint/sprint-summary checks added.

---

## Changelog v1.4.1 (2026-06-12 — user feedback after live testing; ADR-013)

48. **§6 — Reports layout (UI-expert pass)** — replace the cramped flex-row layout with a
    vertical, sectioned single-column report (placement chosen by a UI-expert review,
    rationale in `docs/REPORTS-LAYOUT.md`).
49. **§6 — Reports are story-points focused** — drop issue-count metrics (no "issues
    done/total"; by-assignee table shows points only, not done/total issues). Carryover
    shown as **points** (committed − completed). Blocked stays only as an optional risk
    flag. The issue lists still enumerate individual issues.
50. **§6 — 2-decimal point formatting** — all point values render with ≤2 decimals,
    trailing zeros trimmed, via a shared pure `formatPoints()` (replaces `.toFixed(1)`).
51. **§6.1 — "My Issues" quick filter removed** from the Dashboard sprint filter (and its
    `localStorage` key); the plain Assignee `<select>` remains the filter. ADR-013.

---

## Changelog v1.5 (2026-06-12 — user-directed: DoD, velocity context, leaves/capacity)

52. **Definition of Done = done OR code review (ADR-014)** — `get_sprint_report` counts
    code-review issues as completed (completion summary + by-assignee + velocity math);
    `get_active_sprint.totals` gains `storyPointsCodeReview`, and the Dashboard progress
    bar + pace chip treat `storyPointsDone + storyPointsCodeReview` as completed (the board
    still shows Code Review as its own column). Applies to Reports AND Dashboard.
53. **§4.13 `get_velocity` — selected-sprint context (ADR-015)** — new `beforeSprintId`;
    Reports passes the selected sprint so velocity = the N closed sprints *before* it,
    refetching on sprint change.
54. **§4.14 `get_leaves`/`set_leaves` (new, ADR-016)** — per-sprint leaves/offset tracker
    persisted to a **bridge-side JSON file** (`JIRA_LEAVES_FILE`) — the project's first
    stateful store (deliberate, user-chosen). Registered MCP tools + bridge; keyless/offline
    tests via temp file.
55. **§6 — Reports full-width grid (ADR-016)** — supersedes the v1.4.1 single-column;
    a UI-expert full-width responsive dashboard grid (not simple vertical, not old flex-row).
56. **§6 — Leaves calendar + capacity (ADR-016)** — per-sprint working-day leaves calendar
    (editable, persisted), a **Leaves** column in the by-assignee table, and a
    capacity-adjusted **"possible committed velocity"** (`capacity.ts`: avg × availability),
    labeled a heuristic, shown beside the raw forecast.
57. **§3 — env** — added `JIRA_LEAVES_FILE` (default `<mcp-jira pkg>/.loopboard-leaves.json`,
    git-ignored).

---

## Changelog v1.6 (2026-06-15 — user-directed: separate PO board + repo dev-all script)

58. **§2/§4.9 — `GET /api/health` (mcp-jira) gains `boards`** — `{ dev:{id,projectKey},
    po:{id,projectKey} }` from config (no Jira call), so the app can offer a PO/Dev switch
    without env access. ADR-017.
59. **§6 — Board toggle on Dashboard + Reports** — a Dev/PO switch (default Dev) scopes
    every board call (`get_active_sprint`/`get_daily_huddle`/`list_sprints`/
    `get_sprint_report`/`get_velocity`/`create_sprint`) to the chosen board's id. PO and Dev
    boards + reports are fully separate. Boards with no sprints show a friendly empty state.
    `boards.ts` + `useBoards()`. ADR-017.
60. **§6 — TicketGen: separate PO & Dev target sprints** — two "Add to sprint" selects (PO
    sprint → `create_po_ticket`, Dev sprint → `create_dev_ticket`), so a linked PO+Dev pair
    can be created into their respective boards' sprints in one action. ADR-017.
61. **Repo — `npm run dev:all`** (`scripts/dev-all.mjs`, dependency-free) starts the jira
    bridge + github bridge + Vite together with labeled output and clean shutdown; added
    `npm run smoke`. No tool/contract change.

---

## Changelog v1.7 (2026-06-15 — user-directed: Sprint Preparation / Planning page)

62. **§4.15 `get_assignable_users` / `assign_issue` (new tools, ADR-018)** — list a project's
    assignable developers (active, by accountId) and assign/unassign a ticket
    (`PUT issue/{key}/assignee`, a real write). Registered MCP tools + bridge.
63. **§6 — new Planning (Sprint Preparation/Grooming) page** that consolidates the prep
    workflow, default-targeting the **next future sprint** on the selected board. It
    **moves in**: the **New Sprint** button (off the Dashboard), **ticket generation** (the
    "Ticket Generator" tab is REMOVED; its component is reused inside Planning), and the
    **editable leaves/capacity plotter** (off Reports — Reports keeps a read-only Leaves
    column + capacity). It **adds**: a **developer-assignment** list (the planned sprint's
    tickets, each with an assignee `<select>` from `get_assignable_users` → `assign_issue`).
    Tab nav becomes **Dashboard · Planning · Reports**. The leaves plotter is rostered from
    `get_assignable_users` (the team), not just current assignees. ADR-018.

---

## Changelog v1.8 (2026-06-15 — user: curated team roster, not org-wide assignable list)

64. **Bug: assignment/leaves rostered the whole org.** `get_assignable_users`
    (`/user/assignable/search`) returns everyone with the Assignable User permission, not a
    team — so strangers appeared. **Fix (ADR-019):** a **curated per-board team roster**,
    seeded from recent-sprint assignees, editable (add/remove), persisted to a bridge-side
    JSON file (`JIRA_TEAM_FILE`).
65. **§4 — `IssueSummary.assigneeAccountId`** added (Jira accountId) so assignment can
    pre-select the current assignee and recent-assignee derivation has accountIds.
66. **§4.16 (new) — `get_recent_assignees`** (distinct assignees from the last N sprints,
    the "usual members"), **`get_team_members`** / **`set_team_members`** (persisted roster,
    add/remove = replace list). Registered MCP tools.
67. **§6 — Planning team management** — leaves plotter + assignment dropdown now roster from
    the curated team (`useTeamMembers`); a "Manage team" editor (add from recent sprints /
    optional name search / remove) with first-run seeding; `get_assignable_users` is kept
    only for the optional add-by-name search.
68. **§3 — env `JIRA_TEAM_FILE`** (default `<mcp-jira pkg>/.loopboard-team.json`, git-ignored).
69. **v1.8.1 — Reports leaves editable again** (user request): the Reports leaves calendar is
    clickable again (reverses the v1.7/ADR-018 read-only), rostered from the report sprint's
    assignees, persisting to the same `get_leaves`/`set_leaves` store as Planning
    (`LeavesCalendarCard` rendered without `readOnly`).

---

## Changelog v1.9 (2026-06-16 — user: broaden recents, search-all, drop off-team lock; ADR-020)

70. **Bug: `get_recent_assignees` missed most of the team** — it sampled only the latest **3
    closed** sprints (closed-first, sliced to `sprintCount`), so the **active sprint** was never
    scanned and only ~3–4 people surfaced. **Fix (§4.16, ADR-020):** scan the **whole board**
    for recently-assigned issues — `GET board/{id}/issue?jql=assignee IS NOT EMPTY AND
    updated >= -{withinDays}d ORDER BY updated DESC&fields=assignee`, paged to `maxResults`.
    Input `sprintCount` → **`withinDays` (default 90)**, `maxResults` default 100 → **200**.
    New jiraClient helper `getBoardAssigneesRaw`.
71. **§6 — "Search all people" in Manage Team** — the recent list is no longer a ceiling. A
    search box over the **full** assignable list (`useAssignableUsers(boardId)` →
    `get_assignable_users`, client-side name filter) lets ANY person be added, recent or not.
    "Add from recent sprints" relabeled **"Add from recent activity"** (board-wide source).
72. **§6 — assignment off-team lock removed** (user request): a ticket's current assignee who is
    NOT on the curated team is now a **normal selectable** option (plain name) instead of a
    disabled "(not on team)" entry — assignment is preserved and re-selectable. Dropdown stays
    **Unassigned + curated team (+ current off-team assignee)**; still not the org-wide list.
73. **§2/§3 — configurable CORS + Docker deployment** (user request): bridge CORS allowlist now
    reads **`CORS_ORIGINS`** (comma-separated; `*` = any) at request time, default = the prior
    localhost origins (`parseCorsOrigins` in both `http.ts`). Added a containerized stack —
    `docker-compose.yml`, `docker/{jira,github,web}.Dockerfile`, `docker/nginx.conf` (SPA +
    same-origin reverse proxy `/jira`→:4001, `/github`→:4002), `.dockerignore`,
    `.env.docker.example` — plus `docs/DEPLOYMENT.md` and `docs/ARCHITECTURE.md` §7–§8. No tool
    IO changed.

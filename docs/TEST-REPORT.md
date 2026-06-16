# Test Report — Loopboard POC

**Date:** 2026-06-11  
**Role:** QA Engineer  
**Scope:** Cross-package verification of packages/mcp-jira, packages/mcp-github, packages/react-app

---

## 1. Test Pyramid Breakdown

### packages/mcp-jira (93 tests after fixes)

| Layer | File(s) | Tests | What is covered |
|---|---|---|---|
| Unit | test/adf.test.ts | 17 | textToAdf / adfToText — all node types, null doc, edge cases |
| Unit | test/config.test.ts | 7 | getConfig() happy path, missing vars → ConfigError, cache/reset |
| Unit | test/jiraClient.test.ts | 16 | createIssue, createIssueLink, getActiveSprints, getSprintIssues, getIssue, updateIssue, isBlocked, mapIssue — axios mocked |
| Unit | test/prompts.test.ts | 13 | draftTicketsPrompt, enhanceTicketPrompt, dailyHuddlePrompt output strings |
| Integration | test/tools.test.ts | 31 | All 6 tool handlers with jiraClient mocked: happy paths + unhappy paths (bad input, upstream errors, refine validation) |
| Integration | test/http.test.ts | 9 | HTTP bridge via ephemeral port: health, tools list, 404, 400, 502, CORS |

**Coverage gap before fixes:** No HTTP-level test for the `update_ticket` `.refine()` → 400 path. Exact-string assertion missing for zero-blocked `summaryText`.

### packages/mcp-github (46 tests)

| Layer | File(s) | Tests | What is covered |
|---|---|---|---|
| Unit | test/jiraKeys.test.ts | 12 | detectJiraKeys — regex, prefix filtering, null body, dedup, order |
| Unit | test/config.test.ts | 6 | getConfig() happy path, missing vars → ConfigError, reset |
| Integration | test/tools.test.ts | 21 | list_prs, get_pr, link_pr_to_ticket, sync_pr_links handlers; resolveRepo, derivePrState, toPrSummary; ValidationError paths |
| Integration | test/http.test.ts | 7 | HTTP bridge via dynamic import: health, tools, 404, 400, 502, 200 |

### packages/react-app (90 tests)

| Layer | File(s) | Tests | What is covered |
|---|---|---|---|
| Unit | src/lib/chatRouter.test.ts | 25 | All commands, invalid keys, unknown input, link pr with/without key |
| Unit | src/lib/mcpClient.test.ts | 10 | callTool: ok envelope, error envelope, network failure, non-JSON response |
| Unit | src/lib/ticketTemplates.test.ts | 18 | PO story / Dev task template generation |
| Component | src/components/SprintBoard.test.tsx | 15 | Loading, error (BRIDGE_DOWN), empty, data states; blocked flag; refresh |
| Component | src/components/HuddleDigest.test.tsx | 13 | Loading, error, empty, data, copy-to-clipboard |
| Component | src/pages/TicketGen.test.tsx | 9 | Draft preview, field population, Back, Create in Jira, success panel, reset |

---

## 2. Gate Results Matrix

### Before fixes (baseline from builder reports)

| Gate | mcp-jira | mcp-github | react-app |
|---|---|---|---|
| typecheck | PASS | PASS | PASS |
| test | PASS (92) | PASS (46) | PASS (90) |
| build | PASS | PASS | PASS |

### After fixes (verified by this QA run)

| Gate | mcp-jira | mcp-github | react-app |
|---|---|---|---|
| typecheck | PASS | PASS | PASS |
| test | PASS (93) | PASS (46) | PASS (90) |
| build | PASS | PASS | PASS |

Total: 229 tests, 0 failures.

---

## 3. Smoke Test Results

Run via `node scripts/smoke.mjs`. 17/17 checks passed.

| Check | Result |
|---|---|
| [JIRA] bridge started and health endpoint reachable | PASS |
| [JIRA] health shape: ok=true service=mcp-jira version=0.1.0 | PASS |
| [JIRA] /api/tools count=6 | PASS |
| [JIRA] /api/tools all contract names present | PASS |
| [JIRA] POST /api/tools/nope → 404 UNKNOWN_TOOL | PASS |
| [JIRA] POST create_po_ticket {} → 400 VALIDATION with issues array | PASS |
| [JIRA] POST update_ticket {ticketKey:DEV-1} → 400 VALIDATION (refine path) | PASS |
| [GITHUB] bridge started and health endpoint reachable | PASS |
| [GITHUB] health shape: ok=true service=mcp-github version=0.1.0 | PASS |
| [GITHUB] /api/tools count=4 | PASS |
| [GITHUB] /api/tools all contract names present | PASS |
| [GITHUB] POST /api/tools/nope → 404 UNKNOWN_TOOL | PASS |
| [GITHUB] POST link_pr_to_ticket {} → 400 VALIDATION | PASS |
| [STDIO-JIRA] stderr contains startup line | PASS |
| [STDIO-JIRA] stdout is empty | PASS |
| [STDIO-GITHUB] stderr contains startup line | PASS |
| [STDIO-GITHUB] stdout is empty | PASS |

Stub env used: `JIRA_BASE_URL=https://stub.invalid`, `JIRA_EMAIL=stub@stub.dev`, `JIRA_API_TOKEN=stub`, `JIRA_PO_BOARD_ID=1`, `JIRA_DEV_BOARD_ID=2`, `GITHUB_TOKEN=stub`, `GITHUB_REPO=stub/stub`. Ports 4101/4102.

---

## 4. Cross-Package Consistency Audit

### 4.1 Tool names: React app ↔ servers

All `callTool` invocations in chatRouter.ts, useJira.ts, useGithub.ts were compared against `tools.name` in each server's `src/tools/index.ts`.

| Tool name called by React | Registered in | Match |
|---|---|---|
| `get_daily_huddle` | mcp-jira getDailyHuddle.ts | MATCH |
| `get_active_sprint` | mcp-jira getSprint.ts | MATCH |
| `get_ticket` | mcp-jira getTicket.ts | MATCH |
| `update_ticket` | mcp-jira updateTicket.ts | MATCH |
| `create_po_ticket` | mcp-jira createPoTicket.ts | MATCH |
| `create_dev_ticket` | mcp-jira createDevTicket.ts | MATCH |
| `list_prs` | mcp-github listPrs.ts | MATCH |
| `link_pr_to_ticket` | mcp-github linkPrToTicket.ts | MATCH |

No mismatches found.

### 4.2 Input field names: React hooks ↔ Zod schemas

Checked useJira.ts and useGithub.ts against each tool's Zod schema.

| Hook call | Fields sent | Schema fields | Match |
|---|---|---|---|
| useActiveSprint | `{boardId?}` | `boardId?: number` | MATCH |
| useDailyHuddle | `{boardId?}` | `boardId?: number` | MATCH |
| createTicketPair / create_po_ticket | `{summary, description, storyPoints?}` | `summary, description, storyPoints?` | MATCH |
| createTicketPair / create_dev_ticket | `{summary, description, linkedPoTicketKey}` | `summary, description, linkedPoTicketKey?` | MATCH |
| enhanceTicket / get_ticket | `{ticketKey}` | `ticketKey: string` | MATCH |
| enhanceTicket / update_ticket | `{ticketKey, description}` | `ticketKey, summary?, description?` | MATCH |
| usePrs | `{repo?}` | `repo?: string` | MATCH |
| linkPr | `{number, ticketKey?, repo?}` | `repo?, number, ticketKey?` | MATCH |
| chatRouter / link_pr_to_ticket | `{number, ticketKey?}` | `repo?, number, ticketKey?` | MATCH |

No mismatches found.

### 4.3 Output fields: React components ↔ server tool outputs

SprintBoard reads `GetActiveSprintOutput`: `sprint.{name,state,startDate,endDate,goal}`, `issuesByStatus.{todo,inprogress,done}[]`, `totals.{blocked,storyPointsDone,storyPointsTotal,done,total}`, `IssueSummary.{key,summary,status,statusCategory,assignee,storyPoints,issueType,url,blocked}` — all fields present in getSprint.ts SprintOutput interface and in react-app types.ts. MATCH.

HuddleDigest reads `GetDailyHuddleOutput`: `sprintName`, `boardId`, `generatedAt`, `inProgress`, `blocked`, `done`, `upNext` (`HuddleItem[]`), `summaryText` — all present in getDailyHuddle.ts HuddleOutput and types.ts. MATCH.

TicketGen calls `create_po_ticket` → `TicketRef{key,url,board}` and `create_dev_ticket` → `TicketRef & {linkedTo?,linkWarning?}` — matches createDevTicket.ts output. MATCH.

ChatPanel (EnhanceAction) calls `update_ticket` and expects `UpdateTicketOutput{key,url,updatedFields}` — matches updateTicket.ts output. MATCH.

### 4.4 HTTP bridge envelope consistency: mcp-jira vs mcp-github

Both bridges implement the contract envelope correctly:

| Aspect | mcp-jira | mcp-github | Same? |
|---|---|---|---|
| Success: `{ok:true, data}` | Yes | Yes | MATCH |
| Error: `{ok:false, error:{code,message,issues?}}` | Yes | Yes | MATCH |
| 400 VALIDATION | ZodError caught, issues from err.issues | ValidationError with issues array | MATCH (both produce issues) |
| 404 UNKNOWN_TOOL | errorResponse helper | inline json | MATCH |
| 502 UPSTREAM | UpstreamError caught | UpstreamError caught | MATCH |
| 500 CONFIG | ConfigError caught | ConfigError caught | MATCH |
| 500 INTERNAL | fallback catch | fallback catch | MATCH |
| CORS origins | localhost:5173, 127.0.0.1:5173 | localhost:5173, 127.0.0.1:5173 | MATCH |
| CORS methods | GET, POST | GET, POST | MATCH |

One structural difference noted (not a contract violation): mcp-jira http.ts guards `app.listen()` behind `process.env["VITEST"] !== "true"` and exports only `app`. mcp-github http.ts calls `getConfig()` + `app.listen()` at module-load time and exports both `app` and `server`. mcp-github's http.test.ts handles this via dynamic import after setting env vars. Both approaches produce identical runtime behavior.

### 4.5 boardId default semantics

Contract §4.3/§4.6: `boardId` defaults to `parseInt(JIRA_DEV_BOARD_ID)` on the server side. React hooks pass `{}` when no `boardId` is provided (useActiveSprint, useDailyHuddle). The server-side default fires in that case. CORRECT on both server and client.

### 4.6 Exact tool names registered in mcp-jira (6)

`create_po_ticket`, `create_dev_ticket`, `get_active_sprint`, `get_ticket`, `update_ticket`, `get_daily_huddle`.

### 4.7 Exact tool names registered in mcp-github (4)

`list_prs`, `get_pr`, `link_pr_to_ticket`, `sync_pr_links`.

---

## 5. Fixes Made

### Fix 1 — Add HTTP-level test for update_ticket refine → 400 path

**File:** `packages/mcp-jira/test/http.test.ts`

Added `describe("POST /api/tools/update_ticket — 400 VALIDATION via .refine()")` with one `it()`. The new test posts `{ticketKey:"DEV-1"}` (no `summary`, no `description`) through the full Express stack and asserts status 400, code `VALIDATION`, and that the error detail mentions `summary` or `description`. This exercises the fullSchema `.refine()` path inside the handler that the builder flagged as having no HTTP-level coverage.

**Before:** 8 tests in http.test.ts. **After:** 9 tests (mcp-jira total: 92 → 93).

### Fix 2 — Add exact-string assertion for summaryText when 0 blocked

**File:** `packages/mcp-jira/test/tools.test.ts`

Strengthened the existing weak test `"summaryText omits parenthetical when no blocked issues"`. The original only checked `toContain("0 blocked,")` and `not.toMatch(/blocked \(DEV/)`. Added an exact `toBe(...)` assertion matching the full contract §4.6 normative template:

```
"Sprint 'Sprint 7' (2026-06-01 – 2026-06-14): 1 issues — 1 in progress, 0 blocked, 0 done, 0 up next."
```

This verifies the complete string format, including the em-dash separator, the exact spacing around `0 blocked,`, and that no parenthetical appears. The test passes, confirming the implementation is correct.

---

## 6. Residual Risks — Requires Real Credentials for Live Testing

The following can only be validated with actual Jira/GitHub credentials:

| Risk | Why it can't be tested without keys |
|---|---|
| Jira Basic auth header formation (`base64(email:token)`) | axios interceptor in jiraClient.ts — only hits the network in live mode |
| ADF round-trip: create ticket, then get_ticket and verify ADF→text extraction | Requires Jira to accept and return a real ADF document |
| update_ticket 204 → success path | Jira returns 204 No Content; live call needed to verify 204 handling |
| get_active_sprint with a board that has multiple active sprints | Needs a real Jira board; values[0] logic verified only with mocked data |
| blocked detection via JIRA_FLAGGED_FIELD (custom field) | Custom field name is instance-specific; only testable against real Jira data |
| GitHub Octokit auth (Bearer token) + rate limiting | GitHub API key required |
| link_pr_to_ticket remote-link idempotency (globalId upsert) | Requires real Jira + real PR; tests only mock the Jira client call |
| sync_pr_links end-to-end across multiple open PRs | Integration between real GitHub list and real Jira linking |
| CORS preflight from real browser at http://localhost:5173 | Browser enforces CORS; smoke test bypasses it |
| React app renders real sprint data from live Jira board | No Playwright / E2E layer exists; only component-level mocks tested |
| ChatPanel command dispatch through the full network stack | chatRouter.ts is unit-tested; no integration test from UI → bridge → Jira |

---

## 7. How to Re-Run

### All quality gates (from repo root)
```bash
npm run typecheck
npm run test
npm run build
```

### Smoke tests (no .env needed, no real keys)
```bash
node scripts/smoke.mjs
```

Exits 0 on success, non-zero with failure detail. Spawns bridges on ports 4101/4102 with stub credentials; kills them when done.

### Individual package tests
```bash
npm run test -w packages/mcp-jira
npm run test -w packages/mcp-github
npm run test -w packages/react-app
```

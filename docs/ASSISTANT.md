# InvokeBoard Assistant — what the chatbot can do (v1.40)

The floating chat bubble (bottom-right, every page) is InvokeBoard's assistant. It has **two modes**
in one input box:

1. **Structured commands** — deterministic, always available, no AI needed (ADR-002).
2. **Ask (AI)** — free-form questions and change requests, available when `AI_PROVIDER` is
   configured on the Jira bridge (`anthropic` or `github`). The header badge shows the active
   provider/model; when AI is off, commands still work and AI features fall back or disable.

---

## 1. Structured commands (type these literally)

| Command | What it does |
|---|---|
| `help` | Show the command reference |
| `huddle` | Today's standup digest (in progress / blocked / done / up next) |
| `sprint` | Load the active sprint board summary |
| `ticket <KEY>` | Look up one ticket (e.g. `ticket VRDB-2712`) |
| `enhance <KEY> <notes>` | Rewrite a ticket's description using your notes (AI-drafted when AI is on) |
| `create <description>` | Draft **and create** a PO story + Dev task pair (AI-drafted when AI is on) |
| `prs` | List open pull requests (manually tracked list) |
| `link pr <n> [KEY]` | Link PR number to a Jira ticket (e.g. `link pr 47 VRDB-2712`) |

`create` and `enhance` **write to Jira** — the draft is shown for review before creation.

## 2. Ask mode — questions it can answer

Free-form questions run an agentic loop (up to 5 tool steps) over a **read-only allowlist** of
18 tools. It always knows **today's date and the board/sprint you're currently viewing**, so
"this sprint" resolves correctly. **It also remembers the conversation (v1.40)** — your last 8
Ask-mode turns travel with each question, so follow-ups like "who owns *it*?" work.

It can look up, combine, and summarize:

- **Sprint state** — the active sprint's board, per-status buckets, points, blocked items
  (`get_active_sprint`, `get_daily_huddle`)
- **People** — team roster, who's assigned what, per-person progress (`get_team_members`,
  `get_sprint_report`)
- **History & velocity** — closed-sprint reports, committed vs completed, velocity trend
  (`get_sprint_report`, `get_velocity`, `list_sprints`)
- **Tickets & PRs** — one ticket's details, PO↔Dev links, and the pull requests linked to any
  tickets via Jira's Development panel, with review/approval state (`get_ticket`,
  `get_linked_issues`, `get_issue_pull_requests` — v1.40)
- **Leaves & offsets** — this sprint's leaves, every sprint's plotted leaves, and each developer's
  offset wallet balance (`get_leaves`, `get_all_leaves` — v1.40, `get_offset_ledger` — v1.40)
- **Daily-huddle extras** — impediments, post-scrum notes, meeting goal, the manual PR list,
  and the rich meeting notes (deployment notes/links) (`get_impediments`, `get_post_scrum`,
  `get_meeting_goal`, `get_pull_requests`, `get_meeting_notes` — v1.41)

Example questions that work well:

> "Who has the most open points this sprint?"
> "What's blocked right now and who owns it?"
> "Compare our last three sprints' completed points."
> "Is anyone on leave during this sprint?"
> "What's linked to VBPO-102?"

## 3. Changes it can make — always with your confirmation

The model can **propose** these seven writes; nothing executes until you approve the
confirmation dialog (ADR-030 — the AI itself never mutates Jira):

| Ask something like | Proposed action |
|---|---|
| "Set VRDB-2712 to 3 points" / "rename it to …" | `update_ticket` (points / summary / description) |
| "Move VRDB-2712 to In Progress" | `transition_issue` |
| "Move VRDB-2712 to the next sprint" | `move_issue_to_sprint` |
| "Assign VRDB-2712 to Jocel" | `assign_issue` |
| "Set this sprint's goal to …" | `set_sprint_goal` |
| "Create a sprint called Dazzle starting July 16" | `create_sprint` |
| "File vacation for Jocel this Thu–Fri" | `set_leaves` (v1.40 — replaces that person's sprint entries; the assistant reads + merges first) |

It reads first when it needs to resolve names ("next sprint", a person's name) into ids, then
proposes one concrete call. You see the tool + arguments in the dialog before anything happens.

## 4. What it can NOT do (today)

- **Memory is session-local** — the last 8 Ask turns are remembered while the widget is open;
  closing/reloading the app starts fresh.
- **No offset/roster writes** — it can *read* offset balances and *file leaves* (with your
  confirmation), but manual offset adjustments and team-roster changes are UI-only.
- **No whole-board search** — it works from the current sprint/board context; it can't run
  arbitrary JQL.
- **No ticket creation from Ask mode** — use the `create` command (or the Planning/Linking pages).
- **5-step cap** per question — very broad questions ("summarize everything about every sprint")
  may get a partial answer.

## 5. Configuration & where things live

- Enable AI: set `AI_PROVIDER=anthropic` (+ `ANTHROPIC_API_KEY`) or `AI_PROVIDER=github`
  (+ `GITHUB_MODELS_TOKEN`) in the mcp-jira `.env`, restart the bridge. `GET /api/health`
  shows the active provider.
- Read allowlist + proposable writes: `packages/mcp-jira/src/lib/ai/askService.ts`
  (`READ_TOOLS` / `WRITE_TOOLS`) — adding a tool to the assistant is a deliberate one-line,
  audit-friendly change.
- The loop and confirmation flow: `askService.ts` (backend), `ChatPanel.tsx` +
  `ConfirmActionDialog.tsx` (frontend). Contract §4.26 (v1.18/ADR-029, v1.19/ADR-030).

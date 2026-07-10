# Loopboard — User Guide

**Loopboard** is an Agile team dashboard and AI assistant that sits on top of your Jira (and,
optionally, GitHub). It turns your sprint into a live board, a daily-huddle digest, planning and
reporting tools, leave/capacity tracking, and an AI helper that drafts tickets, answers questions,
and turns a ticket into a ready‑to‑paste coding‑agent prompt.

This guide has two parts:
- **[What Loopboard offers](#what-loopboard-offers)** — a tour of every feature.
- **[Setting up Loopboard](#setting-up-loopboard)** — how to connect it to your Jira and run it.

> Deeper docs: developer setup in [`docs/SETUP.md`](SETUP.md), deployment in
> [`docs/DEPLOYMENT.md`](DEPLOYMENT.md), the AI assistant in [`docs/ASSISTANT.md`](ASSISTANT.md),
> and the full API/behavior contract in [`docs/CONTRACTS.md`](CONTRACTS.md).

---

## What Loopboard offers

Loopboard is organized into tabs across the top. Your team works against two Jira boards — a **PO
board** (product / stories) and a **Dev board** (development tasks) — and a board switcher in the
top‑right lets you flip between them on most pages.

### 🟦 Huddle — the daily dashboard

Your run‑the‑standup home screen.

- **Sprint board** — the selected sprint's issues in **To Do · In Progress · Code Review · Done**
  columns, with points, assignees, and a "has‑PR" badge on linked tickets. Filter by assignee.
- **Daily Huddle digest** — a copy‑pastable summary of the sprint, viewable **by status** or **by
  person** (walk‑the‑board‑by‑person standups).
- **Sidebar widgets** (each collapsible — click the chevron in a card's header; your choices are
  remembered):
  - **Needs attention** — auto‑flagged nudges: stale in‑progress tickets, unassigned work, and PRs
    awaiting review.
  - **Meeting goal** — today's standup focus (distinct from the Jira sprint goal).
  - **Meeting notes** — a rich‑text (WYSIWYG) notepad for deployment notes, runbook links, reminders.
  - **Impediments** — a per‑sprint blocker log.
  - **On leave** — who's out today and in the next 7 days.
  - **Code review** — pull requests linked to the sprint's tickets (multi‑repo), with approval status.
- **Fly‑in tracker** — a strip highlighting "fly‑in" tickets across the Dev and PO boards.
- **Auto‑refresh** every few minutes, with a "last updated" stamp.

### 🗓️ Planning — grooming & sprint prep

Everything you need to prepare the next sprint.

- **Create a sprint** and target new tickets into it.
- **Ticket generator** — draft PO stories and Dev tasks (AI‑assisted when AI is enabled; deterministic
  templates otherwise), created straight into the chosen board's sprint.
- **Leaves / team calendar** — plot each teammate's leave by type (Vacation / Emergency / Holiday /
  Offset); the plotter shows each developer's remaining capacity (required points − leave days).
- **Assignment list** — assign the sprint's tickets to developers (bulk‑assign supported), and edit
  story points inline.
- **Team roster** — curate the team members Loopboard plans around (drawn from recent sprint activity).

### 📅 Offset Tracker — leaves & offset wallet

- **Typed leaves** — Vacation, Emergency, Holiday, and **Offset** days per person.
- **Offset wallet** — earned offset banks automatically per sprint; spending auto‑deducts from Offset
  leaves. See each developer's balance and a full **history** of earns and spends.

### 🔗 Linking — turn PO stories into Dev tasks

- Select PO stories and **bulk‑create linked Dev tasks**, with an AI plan drafted from each story's
  description.
- **Point‑driven breakdown** — a story's points auto‑split into one or two Dev tasks on the allowed
  scale (e.g. 4 → 2 + 2), each with its own points and assignee.
- Links are created so the **PO story "depends on" its Dev task(s)**.

### 📊 Reports — sprint review & metrics

- **Per‑sprint report** — committed vs. completed points, completion rate, and a by‑assignee table.
  (Code‑review‑complete counts as done, per your Definition of Done.)
- **Velocity** — the average of recent closed sprints, capacity‑adjusted for leave.
- **Burndown chart** — actual vs. ideal points remaining across the sprint's working days.
- **Retrospective** — a persisted retro (reason for delays, what worked, what didn't, improvements,
  kudos) that also **pre‑fills the full‑report export**.
- **Export** — Copy (Markdown), a **printable PDF**, or a **styled Excel** workbook with a per‑member
  table (committed/completed points + leaves by type + offset balance).
- **AI executive summary** — an on‑demand narrative of the sprint (when AI is enabled).

### ✨ Task Helper — your personal ticket → prompt assistant

A **login‑gated, per‑user** tab: sign up, connect **your own** Jira and GitHub, then:

1. **Pick a ticket** from your sprint.
2. Optionally add repo/stack context.
3. Click **Refine & build prompt** — the AI refines the ticket into a crisp spec and produces a
   **ready‑to‑paste prompt for a coding agent** (Copilot, Claude Code, Cursor).

Your tokens are **encrypted at rest and never shown back to you** (only a masked hint). Nothing is
written back to Jira. See [Enabling the Task Helper](#enabling-the-task-helper) to turn it on.

### 🤖 AI assistant (floating widget)

The lower‑right chat button is available on every tab. When AI is enabled you can **ask questions**
about the current sprint ("what's in code review?", "who owns VRDB‑1234?", "any impediments today?")
and even **propose changes** (update points, move a ticket, set a sprint goal, file leave) — each
change is shown for **confirmation before it's applied**. Nothing is changed without your OK.

---

## Setting up Loopboard

### Prerequisites

- **Node.js 20+** (Node 22 recommended) and npm.
- A **Jira Cloud** account with permission to view your boards, plus an **API token**
  (create one at <https://id.atlassian.com/manage-profile/security/api-tokens>).
- The IDs of your **PO board** and **Dev board** (the number in a board URL:
  `…/RapidBoard.jspa?rapidView=<ID>`).
- *(Optional)* An **AI provider** — an Anthropic API key, or a GitHub token with the **Models: read**
  permission — to enable the AI features. Without it, Loopboard falls back to deterministic templates.
- *(Optional)* A **GitHub** token if you want linked‑PR and repo features.

### 1. Configure your environment

Copy the template and fill it in (root `.env`, or `packages/mcp-jira/.env`):

```bash
cp packages/mcp-jira/.env.example packages/mcp-jira/.env
```

**Required — connect to Jira:**

```ini
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=your-api-token
JIRA_PO_BOARD_ID=10001         # your PO board id
JIRA_DEV_BOARD_ID=10002        # your Dev board id
```

**Optional — tuning** (sensible defaults shown):

```ini
JIRA_STORY_POINTS_FIELD=customfield_10016
JIRA_LINK_TYPE=Depends on            # must match a link type in your Jira
JIRA_CODE_REVIEW_STATUSES=code review,in review,peer review,review
JIRA_VELOCITY_SPRINTS=6
```

**Optional — enable AI** (`anthropic` **or** `github`; leave `AI_PROVIDER` empty to disable):

```ini
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# — or —
AI_PROVIDER=github
GITHUB_MODELS_TOKEN=github-token-with-models-read
```

> **AI not working?** If you see *"GitHub Models authentication failed … PAT needs models:read"*, your
> GitHub token is missing the **Models: read** permission — use a fine‑grained PAT that has it, or
> switch to `AI_PROVIDER=anthropic` with an `ANTHROPIC_API_KEY`.

### 2. Run it

Install once, then start the three processes (two MCP bridges + the web app):

```bash
npm install
npm run dev:all          # starts the Jira bridge (:4001), GitHub bridge (:4002) and web app (:5173)
```

Open **<http://localhost:5173>**. (You can also start each process separately —
`npm run dev:jira:http`, `npm run dev:github:http`, `npm run dev:app` — or deploy with Docker; see
[`docs/DEPLOYMENT.md`](DEPLOYMENT.md).)

### 3. Verify

```bash
npm run typecheck && npm run test && npm run build   # all green, no network needed
node scripts/smoke.mjs                               # boots both bridges with stub creds
```

### Enabling the Task Helper

The Task Helper is **off by default**. To turn it on, add two secrets to the bridge's `.env` and
restart it:

```bash
# generate the values:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → TOKEN_ENC_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # → SESSION_SECRET
```

```ini
TOKEN_ENC_KEY=<32-byte base64 value>
SESSION_SECRET=<random base64 value>
```

Then each teammate opens the **Task Helper** tab, **signs up**, and **connects their own** Jira and
GitHub tokens. Tokens are AES‑256‑GCM encrypted at rest and are never returned to the browser.

---

## Tips & FAQ

- **PO vs. Dev board:** use the board switcher (top‑right) to flip context. Linking and the Task Helper
  work across both.
- **Collapsing clutter:** every Huddle sidebar card collapses via the chevron in its header — handy on
  long sprints. Your choices persist per browser.
- **"Bridge is offline":** a page can't reach the Jira/GitHub bridge — make sure `npm run dev:all` (or
  the individual `dev:*:http` processes) is running.
- **Sprint reports look empty:** confirm the board id is correct and the sprint has issues assigned to
  your rostered team members.
- **Security:** API tokens live only in the server's `.env` (team config) or the encrypted per‑user
  vault (Task Helper). They are never logged or sent to the browser.

---

*Loopboard is a proof‑of‑concept that integrates Jira/GitHub into an Agile workflow via the Model
Context Protocol (MCP). For architecture and design decisions, see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
and the ADRs under [`docs/adr/`](adr/).*

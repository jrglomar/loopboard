# Set Up the Loopboard for Local Development

By the end of this guide you will have all three processes running locally, the MCP servers registered in VS Code, and a working dashboard at http://localhost:5173.

---

## Prerequisites

| Requirement | How to verify |
|---|---|
| Node.js 18 or later | `node --version` |
| npm 9 or later | `npm --version` |
| VS Code with GitHub Copilot extension installed | Open VS Code → Extensions → confirm "GitHub Copilot" is installed and signed in |
| GitHub Copilot license with Claude model enabled | In VS Code Copilot Chat, open model picker and select Claude |
| Jira Cloud access | Project-level access on both the PO board and the Dev board |
| GitHub personal access token | Required for Phase 2 PR tools (see Step 2) |

---

## Overview

The repo contains three npm packages: `mcp-jira` (Phase 1, Jira ticket and sprint tools), `mcp-github` (Phase 2, GitHub PR tools), and `react-app` (Phase 2, the dashboard). Setup takes five steps: install, configure credentials, register MCP servers in VS Code, start the three dev processes, and verify everything works.

---

## Step 1: Install dependencies

From the repo root, install all workspace packages with one command:

```
npm install
```

---

## Step 2: Create your .env file

**Windows:**
```
copy .env.example .env
```

**macOS / Linux:**
```
cp .env.example .env
```

Open `.env` in your editor and fill in each value. The sections below explain where to find each one.

### Jira credentials

**`JIRA_BASE_URL`**
Your Jira Cloud instance URL. Example: `https://yourcompany.atlassian.net`. Find it in your browser's address bar when viewing any Jira page.

**`JIRA_EMAIL`**
The email address of your Atlassian account — the one you use to log in to Jira.

**`JIRA_API_TOKEN`**
Your Atlassian API token. To create one:
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Give it a label (e.g. `loopboard`)
4. Click **Create** and copy the token immediately — it is shown only once

**`JIRA_PO_BOARD_ID` and `JIRA_DEV_BOARD_ID`**
The numeric ID of each Jira board. To find it: open the board in your browser. The URL looks like:

```
https://yourcompany.atlassian.net/jira/software/projects/DEV/boards/10002
```

The last number (`10002`) is the Board ID. Set `JIRA_PO_BOARD_ID` for the PO board and `JIRA_DEV_BOARD_ID` for the Dev board.

**`JIRA_PO_PROJECT_KEY` and `JIRA_DEV_PROJECT_KEY`** (optional, defaults: `PO` / `DEV`)
The short project key shown in ticket numbers (e.g. `PO-42` → key is `PO`). Find it in Jira under **Project settings → Details → Key**. Leave as default if your projects use `PO` and `DEV`.

### Optional Jira tuning

**`JIRA_STORY_POINTS_FIELD`** (default: `customfield_10016`)
The custom field ID used by your Jira instance for story points. If story points are not saving, call `GET /rest/api/3/issue/ANY-KEY` on your instance and look for the field that holds story point values — update this variable to match.

**`JIRA_LINK_TYPE`** (default: `Relates`)
The name of the issue link type used to connect Dev tasks to PO stories. Check **Jira Administration → Issue linking** for the exact name configured in your instance.

**`JIRA_FLAGGED_FIELD`** (default: empty — disabled)
If your Jira instance has a custom "Flagged" or "Impediment" field, set this to its field ID to enable blocked detection in the dashboard. Leave empty to use only label-based and status-name-based detection.

### GitHub credentials (Phase 2)

**`GITHUB_TOKEN`**
A GitHub personal access token. Two options:
- **Classic PAT** — go to https://github.com/settings/tokens → **Generate new token (classic)** → select the `repo` scope
- **Fine-grained PAT** — go to https://github.com/settings/tokens → **Generate new token (fine-grained)** → select the target repository → grant **Pull requests: Read and Write** and **Issues: Read and Write** (PR comments use the Issues API)

Copy the token immediately — GitHub shows it only once.

**`GITHUB_REPO`** (optional)
The default repository in `owner/name` form, e.g. `your-org/your-repo`. Individual tool calls can override this; if both the call and this variable are absent, the call returns a validation error.

---

## Step 3: Register the MCP servers in VS Code

The `.vscode/mcp.json` file in this repo registers both MCP servers and is picked up automatically by VS Code when you open the workspace folder. No manual configuration is required if you open the repo root in VS Code.

**What the file contains:**

```json
{
  "servers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/packages/mcp-jira/src/index.ts"]
    },
    "github-prs": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/packages/mcp-github/src/index.ts"]
    }
  }
}
```

VS Code uses `${workspaceFolder}` to resolve the absolute path automatically.

### Alternative: global VS Code settings.json

If you prefer global registration, open VS Code Settings (Ctrl+,), click **Open Settings (JSON)** (the `{}` icon), and add the following — replacing the path with the absolute path to your clone:

```json
{
  "mcp": {
    "servers": {
      "jira": {
        "command": "npx",
        "args": ["tsx", "C:\\Projects\\loopboard\\packages\\mcp-jira\\src\\index.ts"],
        "env": {}
      },
      "github-prs": {
        "command": "npx",
        "args": ["tsx", "C:\\Projects\\loopboard\\packages\\mcp-github\\src\\index.ts"],
        "env": {}
      }
    }
  }
}
```

> **Windows paths:** use double backslashes (`\\`) in the JSON string.

---

## Step 4: Start the development processes

Open three separate terminal windows and run one command in each.

**Terminal 1 — Jira HTTP bridge (for the React dashboard):**
```
npm run dev:jira:http
```
Expected output: `mcp-jira HTTP bridge listening on http://localhost:4001`

**Terminal 2 — GitHub HTTP bridge (for the React dashboard):**
```
npm run dev:github:http
```
Expected output: `GitHub MCP server running — waiting for tool calls...` followed by `mcp-github HTTP bridge listening on http://localhost:4002`

**Terminal 3 — React dashboard:**
```
npm run dev:app
```
Expected output: Vite prints a `Local: http://localhost:5173/` line.

> **stdio servers and Copilot:** `dev:jira:http` and `dev:github:http` start the HTTP bridges. The stdio MCP servers (`src/index.ts`) are started automatically by VS Code in the background once you register them in Step 3 — you do not run `npm run dev:jira` or `npm run dev:github` for Copilot use.

---

## Step 5: Verify everything works

**1. Check bridge health endpoints**

In a browser or with curl, open both health URLs. Each should return `{"ok":true,...}`:

```
http://localhost:4001/api/health
http://localhost:4002/api/health
```

**2. Check the dashboard loads sprint data**

Open http://localhost:5173 in your browser. If your `.env` credentials are correct and there is an active sprint, the Dashboard page should show the three-column sprint board. If the sprint data shows an empty state but no error, your Jira boards may not have an active sprint — start one in Jira and refresh.

**3. Try the huddle command in the chat panel**

On the Dashboard page, click the ChatPanel area and type:

```
huddle
```

The panel should show a daily standup digest pulled live from your active sprint.

**4. Test ticket creation via Copilot Chat**

Open GitHub Copilot Chat in VS Code (`Ctrl+Shift+I`) and type:

```
Create a PO story and dev task for password reset via email
```

Claude will call `create_po_ticket` and `create_dev_ticket` via the registered MCP server. Both tickets should appear in Jira within a few seconds.

**5. Run the keyless smoke suite (optional, no credentials touched)**

```
node scripts/smoke.mjs
```

19 checks against both bridges with stub credentials; exits 0 when healthy.

---

## Step 6 (optional): Enable AI drafting in the dashboard

By default the Ticket Generator and the ChatPanel `create`/`enhance` commands use
deterministic local templates. Setting `AI_PROVIDER` in `.env` turns the Ticket Generator
into an AI chat that analyzes your one-liner and produces detailed, editable PO/Dev
drafts before anything is created in Jira (see ADR-006). The key stays on the bridge —
it is never sent to the browser.

**Option A — Anthropic API (Claude):**

1. Create an API key at https://platform.claude.com (Settings → API keys).
2. In `.env`:
   ```
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   # optional: ANTHROPIC_MODEL=claude-opus-4-8   (default)
   ```

**Option B — GitHub Models (free tier on your existing PAT):**

1. Your `GITHUB_TOKEN` is reused automatically. Fine-grained PATs need the
   **Models: Read** account permission (github.com → Settings → Developer settings →
   Fine-grained tokens → Account permissions → Models). Classic PATs work on the free
   tier without an extra scope. To use a separate token, set `GITHUB_MODELS_TOKEN`.
2. In `.env`:
   ```
   AI_PROVIDER=github
   # optional: GITHUB_MODELS_MODEL=openai/gpt-4o-mini   (default)
   ```

**Then restart the Jira bridge** (`npm run dev:jira:http`). Verify:
http://localhost:4001/api/health should show
`"ai": { "enabled": true, "provider": "...", "model": "..." }`, and the Ticket
Generator page shows an `AI: <provider> · <model>` badge with a chat input.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Missing Jira credentials` error on startup | `.env` file missing or a required variable is empty | Run `copy .env.example .env` (Windows) and fill in all required values |
| `401 Unauthorized` from Jira | API token expired or wrong | Generate a new token at https://id.atlassian.com → API tokens |
| `No active sprint found for board <id>` | Board has no active sprint | Start a sprint in Jira for the board ID in `.env` |
| Story points not saving | Wrong custom field ID for your Jira instance | Call `GET /rest/api/3/issue/ANY-KEY` and find the story points field name; update `JIRA_STORY_POINTS_FIELD` |
| MCP server not visible in Copilot | `.vscode/mcp.json` not loaded or server not running | Confirm the workspace folder is open in VS Code; check Copilot Chat settings |
| Tickets created on wrong board | Wrong project key in `.env` | Check `JIRA_PO_PROJECT_KEY` and `JIRA_DEV_PROJECT_KEY` match the actual Jira project keys |
| Dashboard shows "run: npm run dev" message | HTTP bridge is not running | Start the bridge: `npm run dev:jira:http` in a terminal |
| Dashboard shows "run: npm run dev" for GitHub tools | GitHub bridge is not running | Start the bridge: `npm run dev:github:http` in a terminal |
| CORS error in the browser console | App is not on port 5173 or bridge is not on 4001/4002 | Confirm Vite is running on 5173 and bridges are on 4001/4002; if you changed a port, update both `MCP_*_HTTP_PORT` and the corresponding `VITE_MCP_*_URL` together |
| Port already in use | Another process is on 4001, 4002, or 5173 | Change `MCP_JIRA_HTTP_PORT` or `MCP_GITHUB_HTTP_PORT` in `.env` AND update `VITE_MCP_JIRA_URL` / `VITE_MCP_GITHUB_URL` to match |
| `401` from GitHub PR tools | Token scope too narrow | Re-create the token with `repo` scope (classic) or Pull requests + Issues Read/Write (fine-grained) |
| TicketGen shows "AI drafting is off" banner | `AI_PROVIDER` empty or bridge not restarted after editing `.env` | Set `AI_PROVIDER=anthropic` or `github` in `.env`, restart `npm run dev:jira:http` |
| `Anthropic authentication failed` | Wrong/expired `ANTHROPIC_API_KEY` | Create a new key at https://platform.claude.com and update `.env` |
| `GitHub Models authentication failed` | PAT lacks `models:read` (fine-grained) | Add the Models: Read account permission, or set `GITHUB_MODELS_TOKEN` to a token that has it |
| GitHub Models 404 | Endpoint moved / older tenant | Set `GITHUB_MODELS_BASE_URL` (legacy: `https://models.inference.ai.azure.com`) |
| Sprint board shows the wrong sprint | Board has multiple active sprints | v1.1 defaults to the latest-started; use the Sprint dropdown in the board header to switch |

---

## Next steps

- [README.md](../README.md) — project overview, configuration reference, roadmap
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — C4 diagrams, data flow walkthroughs, architectural patterns
- [docs/CONTRACTS.md](CONTRACTS.md) — authoritative tool IO, HTTP API, and env spec
- [docs/TEST-REPORT.md](TEST-REPORT.md) — QA test results

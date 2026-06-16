// Deterministic command router for ChatPanel — ADR-002
// PURE function: no side effects, no network, fully unit-testable.

// ── Action discriminated union ────────────────────────────────────────────────

export interface HelpAction {
  kind: "help";
  text: string;
}

export interface HuddleAction {
  kind: "tool";
  server: "jira";
  tool: "get_daily_huddle";
  input: Record<string, never>;
  render: "huddle";
}

export interface SprintAction {
  kind: "tool";
  server: "jira";
  tool: "get_active_sprint";
  input: Record<string, never>;
  render: "sprint";
}

export interface TicketAction {
  kind: "tool";
  server: "jira";
  tool: "get_ticket";
  input: { ticketKey: string };
  render: "ticket";
}

export interface EnhanceAction {
  kind: "tool";
  server: "jira";
  tool: "update_ticket";
  input: { ticketKey: string; description: string };
  render: "ticket-updated";
}

export interface CreateAction {
  kind: "create";
  description: string;
  render: "ticket-pair";
}

export interface PrsAction {
  kind: "tool";
  server: "github";
  tool: "list_prs";
  input: Record<string, never>;
  render: "pr-list";
}

export interface LinkPrAction {
  kind: "tool";
  server: "github";
  tool: "link_pr_to_ticket";
  input: { number: number; ticketKey?: string };
  render: "link-result";
}

export type RouterAction =
  | HelpAction
  | HuddleAction
  | SprintAction
  | TicketAction
  | EnhanceAction
  | CreateAction
  | PrsAction
  | LinkPrAction;

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `**Sprint Commands** (type one of these)

• \`help\`               — show this reference
• \`huddle\`             — today's standup digest (in-progress, blocked, done, up next)
• \`sprint\`             — load the active sprint board
• \`ticket <KEY>\`       — look up a ticket  (e.g. \`ticket DEV-42\`)
• \`enhance <KEY> <notes>\` — rewrite a ticket's description with your notes
• \`create <description>\`  — draft + create a PO story and Dev task pair
• \`prs\`                — list open pull requests
• \`link pr <n> [KEY]\`  — link PR number to a Jira ticket  (e.g. \`link pr 47 DEV-99\`)

When AI is on (AI_PROVIDER set), \`create\` and \`enhance\` produce AI-drafted content.

---
For free-form questions ("Why is DEV-99 blocked?", "What did we finish last sprint?")
use **GitHub Copilot Chat** in VS Code — that's where the full AI reasoning lives.
This panel handles structured sprint commands only (ADR-002 — intentional scope).`;

// ── Jira ticket-key pattern ───────────────────────────────────────────────────

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

function isTicketKey(s: string): boolean {
  return KEY_RE.test(s);
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Parse raw chat input and return a discriminated action.
 * Case-insensitive on command names; ticket keys preserved as-is.
 * Unknown input → HelpAction with explanation.
 */
export function router(raw: string): RouterAction {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // help
  if (lower === "help") {
    return { kind: "help", text: HELP_TEXT };
  }

  // huddle
  if (lower === "huddle") {
    return {
      kind: "tool",
      server: "jira",
      tool: "get_daily_huddle",
      input: {},
      render: "huddle",
    };
  }

  // sprint
  if (lower === "sprint") {
    return {
      kind: "tool",
      server: "jira",
      tool: "get_active_sprint",
      input: {},
      render: "sprint",
    };
  }

  // ticket <KEY>
  const ticketMatch = trimmed.match(/^ticket\s+([^\s]+)$/i);
  if (ticketMatch) {
    const key = ticketMatch[1].toUpperCase();
    if (isTicketKey(key)) {
      return {
        kind: "tool",
        server: "jira",
        tool: "get_ticket",
        input: { ticketKey: key },
        render: "ticket",
      };
    }
    return {
      kind: "help",
      text: `"${ticketMatch[1]}" doesn't look like a valid Jira key (expected format: PROJECT-123).\n\n${HELP_TEXT}`,
    };
  }

  // enhance <KEY> <notes...>
  const enhanceMatch = trimmed.match(/^enhance\s+([^\s]+)\s+(.+)$/is);
  if (enhanceMatch) {
    const key = enhanceMatch[1].toUpperCase();
    const notes = enhanceMatch[2].trim();
    if (isTicketKey(key)) {
      return {
        kind: "tool",
        server: "jira",
        tool: "update_ticket",
        input: { ticketKey: key, description: notes },
        render: "ticket-updated",
      };
    }
    return {
      kind: "help",
      text: `"${enhanceMatch[1]}" doesn't look like a valid Jira key (expected format: PROJECT-123).\n\n${HELP_TEXT}`,
    };
  }

  // create <description...>
  const createMatch = trimmed.match(/^create\s+(.+)$/is);
  if (createMatch) {
    const description = createMatch[1].trim();
    if (description.length > 0) {
      return {
        kind: "create",
        description,
        render: "ticket-pair",
      };
    }
  }

  // prs
  if (lower === "prs") {
    return {
      kind: "tool",
      server: "github",
      tool: "list_prs",
      input: {},
      render: "pr-list",
    };
  }

  // link pr <n> [KEY]
  const linkMatch = trimmed.match(/^link\s+pr\s+(\d+)(?:\s+([^\s]+))?$/i);
  if (linkMatch) {
    const prNumber = parseInt(linkMatch[1], 10);
    const rawKey = linkMatch[2];
    if (rawKey) {
      const key = rawKey.toUpperCase();
      if (!isTicketKey(key)) {
        return {
          kind: "help",
          text: `"${rawKey}" doesn't look like a valid Jira key (expected format: PROJECT-123).\n\n${HELP_TEXT}`,
        };
      }
      return {
        kind: "tool",
        server: "github",
        tool: "link_pr_to_ticket",
        input: { number: prNumber, ticketKey: key },
        render: "link-result",
      };
    }
    return {
      kind: "tool",
      server: "github",
      tool: "link_pr_to_ticket",
      input: { number: prNumber },
      render: "link-result",
    };
  }

  // Unknown input → help
  return {
    kind: "help",
    text: `Unknown command: "${trimmed.slice(0, 80)}"\n\n${HELP_TEXT}`,
  };
}

/**
 * AI Q&A assistant — agentic tool-calling loop over READ-ONLY tools (v1.18, ADR-029).
 *
 * Given a free-form question + the current sprint/board context, the model is offered a
 * curated allowlist of mcp-jira READ tools (as JSON-Schema function specs). On each turn it
 * may request tool calls; we run the matching ToolDef.handler IN-PROCESS, feed results back,
 * and loop (capped) until it returns a final answer. No write tools are ever exposed.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { AiProvider, AiToolMessage, AiToolSpec } from "./provider.js";
import { tools as allTools } from "../../tools/index.js";
import type { ToolDef } from "../toolDef.js";

/**
 * Read-only allowlist — the assistant can ONLY observe, never mutate Jira. Adding a new
 * read tool to the assistant is a deliberate one-line change here (audit-friendly).
 */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  "get_active_sprint",
  "get_daily_huddle",
  "get_impediments",
  "get_pull_requests",
  "get_post_scrum",
  "get_meeting_goal",
  "get_leaves",
  "get_sprint_report",
  "get_velocity",
  "get_team_members",
  "get_ticket",
  "list_sprints",
  "get_linked_issues",
  // v1.40 (ADR-050): dev-panel PRs + cross-sprint leaves + offset wallet.
  "get_issue_pull_requests",
  "get_all_leaves",
  "get_offset_ledger",
  // v1.41 (ADR-051): the Huddle's rich meeting notes (deployment notes, links).
  "get_meeting_notes",
  // v1.42 (ADR-052): the persisted retrospective.
  "get_retro",
  // v1.59 (ADR-071): windowed multi-sprint report for trends/KPI questions.
  "get_multi_sprint_report",
]);

/**
 * Write tools the assistant may PROPOSE (v1.19, ADR-030). These are offered to the model
 * but NEVER executed by the loop — a request for one is returned as a `proposedAction`
 * for the UI to confirm in a modal, then the UI executes it. The AI never mutates Jira.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "update_ticket",
  "transition_issue",
  "move_issue_to_sprint",
  "create_sprint",
  "set_sprint_goal",
  "assign_issue",
  // v1.40 (ADR-050): "file my vacation Thu–Fri" — proposal-only, confirmed in the modal.
  "set_leaves",
]);

const MAX_TURNS = 5;

/** One prior Ask-mode exchange turn (v1.40, ADR-050) — folded into the system prompt. */
export interface AskHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_CHARS = 500; // per turn, when folded into the system prompt

export interface AskContext {
  boardId?: number;
  sprintId?: number;
  today: string; // YYYY-MM-DD
  /** Prior conversation turns, oldest first (optional — omitted = stateless). */
  history?: AskHistoryTurn[];
}

export interface ProposedAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface AskResult {
  answer: string;
  toolsUsed: string[];
  provider: "anthropic" | "github";
  model: string;
  /** v1.19: a write the model wants to make — surfaced for human confirmation, NOT executed. */
  proposedAction?: ProposedAction;
}

function buildToolSpecs(): { specs: AiToolSpec[]; readByName: Map<string, ToolDef> } {
  // Offer READ + WRITE specs; only READ tools are executed in-process (writes are proposed).
  const offered = allTools.filter((t) => READ_TOOLS.has(t.name) || WRITE_TOOLS.has(t.name));
  const readByName = new Map<string, ToolDef>(
    offered.filter((t) => READ_TOOLS.has(t.name)).map((t) => [t.name, t])
  );
  const specs: AiToolSpec[] = offered.map((t) => {
    const json = zodToJsonSchema(t.schema, { $refStrategy: "none" }) as Record<string, unknown>;
    delete json["$schema"];
    return { name: t.name, description: t.description, parameters: json };
  });
  return { specs, readByName };
}

function buildSystem(ctx: AskContext): string {
  // v1.40 (ADR-050): fold prior turns into the system prompt (provider-agnostic memory —
  // no adapter changes needed). Capped turns + per-turn chars keep the prompt bounded.
  const history = (ctx.history ?? []).slice(-MAX_HISTORY_TURNS);
  const historyBlock =
    history.length > 0
      ? [
          "",
          "Conversation so far (oldest first) — use it to resolve references like 'it' or 'that ticket':",
          ...history.map(
            (t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, MAX_HISTORY_CHARS)}`
          ),
        ]
      : [];

  return [
    "You are InvokeBoard's Scrum assistant. Answer the user's question about the team's current",
    "sprint using ONLY the provided tools and their results — never invent data.",
    "Be concise and concrete; prefer a short, direct answer. If a tool returns nothing relevant,",
    "say so plainly rather than guessing.",
    "",
    "Current context:",
    `- Today's date: ${ctx.today}`,
    ctx.boardId !== undefined ? `- Active board id: ${ctx.boardId}` : "",
    ctx.sprintId !== undefined
      ? `- Active sprint id: ${ctx.sprintId} — use this for any tool that needs a sprintId.`
      : "",
    "When a tool needs a sprintId/boardId the user didn't specify, use the active ids above.",
    ...historyBlock,
    "",
    "You may also CHANGE things when asked — update points, set status, move a ticket to another",
    "sprint, assign someone, set a sprint goal, create a sprint, or file leaves (set_leaves) — by",
    "calling the matching tool with resolved arguments (read first if you need to resolve a name to",
    "an id, e.g. 'next sprint'). set_leaves REPLACES that person's entries for the sprint, so read",
    "get_leaves first and include their existing days plus the new ones.",
    "The user is shown a confirmation before any change is applied, so just propose the right call.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Run the assistant loop. `provider.chatWithTools` is called until the model returns a
 * final answer, or the turn cap is reached (then one final no-tools call synthesizes).
 */
export async function askAssistant(
  provider: AiProvider,
  question: string,
  ctx: AskContext
): Promise<AskResult> {
  const { specs, readByName } = buildToolSpecs();
  const system = buildSystem(ctx);
  const messages: AiToolMessage[] = [{ role: "user", content: question }];
  const toolsUsed: string[] = [];

  const finish = (answer: string): AskResult => ({
    answer: answer.trim() || "I don't have enough information to answer that.",
    toolsUsed,
    provider: provider.name,
    model: provider.model,
  });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // On the last allowed turn, offer no tools so the model must answer.
    const offerTools = turn < MAX_TURNS - 1 ? specs : [];
    const res = await provider.chatWithTools(system, messages, offerTools);

    if (res.type === "final") return finish(res.text);

    // A WRITE request is NOT executed — return it for the UI to confirm (ADR-030).
    const writeCall = res.calls.find((c) => WRITE_TOOLS.has(c.name));
    if (writeCall) {
      return {
        answer: "",
        toolsUsed: [...toolsUsed, writeCall.name],
        provider: provider.name,
        model: provider.model,
        proposedAction: {
          tool: writeCall.name,
          args: (writeCall.args ?? {}) as Record<string, unknown>,
        },
      };
    }

    // All reads — run each in-process, feed results back.
    messages.push({ role: "assistant_tool_calls", calls: res.calls });
    for (const call of res.calls) {
      toolsUsed.push(call.name);
      const def = readByName.get(call.name);
      let content: string;
      if (!def) {
        content = JSON.stringify({ error: `Tool '${call.name}' is not available.` });
      } else {
        try {
          content = JSON.stringify(await def.handler(call.args));
        } catch (err) {
          content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
      }
      messages.push({ role: "tool_result", id: call.id, name: call.name, content });
    }
  }

  // Turn cap hit while still calling tools — one no-tools call to synthesize an answer.
  const finalRes = await provider.chatWithTools(system, messages, []);
  return finish(
    finalRes.type === "final" ? finalRes.text : "I couldn't complete that within the step limit."
  );
}

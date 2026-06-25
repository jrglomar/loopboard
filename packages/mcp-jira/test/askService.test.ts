// askService tests — v1.18, ADR-029. Keyless/offline: a fake provider drives the loop,
// real read-tool handlers run against a temp impediments store.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";
import { askAssistant, READ_TOOLS, WRITE_TOOLS } from "../src/lib/ai/askService.js";
import type {
  AiProvider, AiToolMessage, AiToolSpec, ChatWithToolsResult,
} from "../src/lib/ai/provider.js";

let dir: string;
let impFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-ask-"));
  impFile = path.join(dir, "imp.json");
  fs.writeFileSync(impFile, JSON.stringify({ "100": [{ id: "a", text: "infra is down", createdAt: "t" }] }));
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_IMPEDIMENTS_FILE"] = impFile;
  resetConfigCache();
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

interface FakeProvider extends AiProvider {
  calls: Array<{ messages: AiToolMessage[]; tools: AiToolSpec[] }>;
}

function fakeProvider(steps: ChatWithToolsResult[]): FakeProvider {
  const calls: Array<{ messages: AiToolMessage[]; tools: AiToolSpec[] }> = [];
  let i = 0;
  return {
    name: "github",
    model: "test-model",
    complete: async () => ({ text: "" }),
    chatWithTools: async (_system: string, messages: AiToolMessage[], tools: AiToolSpec[]) => {
      calls.push({ messages: structuredClone(messages), tools });
      return steps[Math.min(i++, steps.length - 1)]!;
    },
    calls,
  };
}

describe("askService allowlists (v1.18/v1.19)", () => {
  it("READ_TOOLS contains only read tools", () => {
    expect([...READ_TOOLS].every((n) => /^(get_|list_)/.test(n))).toBe(true);
  });

  it("WRITE_TOOLS are the curated mutations, disjoint from READ_TOOLS", () => {
    for (const w of ["update_ticket", "transition_issue", "move_issue_to_sprint", "create_sprint", "set_sprint_goal", "assign_issue"]) {
      expect(WRITE_TOOLS.has(w)).toBe(true);
      expect(READ_TOOLS.has(w)).toBe(false);
    }
  });
});

describe("askService write-actions (v1.19, ADR-030)", () => {
  it("proposes a write action for confirmation instead of executing it", async () => {
    const provider = fakeProvider([
      { type: "tool_calls", calls: [{ id: "w1", name: "update_ticket", args: { ticketKey: "VRDB-2700", storyPoints: 2 } }] },
      { type: "final", text: "(should not be reached)" },
    ]);

    const out = await askAssistant(provider, "update points of VRDB-2700 to 2pts", { sprintId: 100, today: "2026-06-24" });

    expect(out.proposedAction).toEqual({ tool: "update_ticket", args: { ticketKey: "VRDB-2700", storyPoints: 2 } });
    expect(out.toolsUsed).toContain("update_ticket");
    // Returned immediately — the write was NOT executed and the loop did not continue.
    expect(provider.calls).toHaveLength(1);
  });
});

describe("askService loop (v1.18)", () => {
  it("runs a requested read tool in-process and returns the model's final answer", async () => {
    const provider = fakeProvider([
      { type: "tool_calls", calls: [{ id: "c1", name: "get_impediments", args: { sprintId: 100 } }] },
      { type: "final", text: "You have 1 impediment: infra is down." },
    ]);

    const out = await askAssistant(provider, "any impediments today?", { sprintId: 100, today: "2026-06-24" });

    expect(out.answer).toContain("infra is down");
    expect(out.toolsUsed).toEqual(["get_impediments"]);
    // The 1st model turn was offered the read tools (incl. get_impediments).
    expect(provider.calls[0]!.tools.some((t) => t.name === "get_impediments")).toBe(true);
    // The 2nd turn received the REAL tool result (read from the temp store).
    const toolResult = provider.calls[1]!.messages.find((m) => m.role === "tool_result");
    expect(toolResult && JSON.stringify(toolResult)).toContain("infra is down");
  });

  it("refuses a disallowed (write) tool, feeds an error back, and never executes it", async () => {
    const before = fs.readFileSync(impFile, "utf8");
    const provider = fakeProvider([
      { type: "tool_calls", calls: [{ id: "c1", name: "set_impediments", args: { sprintId: 100, impediments: [] } }] },
      { type: "final", text: "I can only read sprint data, not change it." },
    ]);

    const out = await askAssistant(provider, "clear all impediments", { sprintId: 100, today: "2026-06-24" });

    expect(out.answer).toContain("only read");
    // A write tool is never offered to the model…
    expect(provider.calls[0]!.tools.some((t) => t.name === "set_impediments")).toBe(false);
    // …and when requested anyway, the loop returns an error instead of running it.
    const toolResult = provider.calls[1]!.messages.find((m) => m.role === "tool_result");
    expect(toolResult && JSON.stringify(toolResult)).toContain("not available");
    // The store on disk is unchanged — no write happened.
    expect(fs.readFileSync(impFile, "utf8")).toBe(before);
  });
});

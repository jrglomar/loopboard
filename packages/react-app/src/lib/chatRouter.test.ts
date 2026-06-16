import { describe, it, expect } from "vitest";
import { router } from "./chatRouter";

describe("chatRouter", () => {
  // ── help ───────────────────────────────────────────────────────────────────

  it("returns help for 'help'", () => {
    const action = router("help");
    expect(action.kind).toBe("help");
  });

  it("is case-insensitive for help", () => {
    const action = router("HELP");
    expect(action.kind).toBe("help");
  });

  it("returns help with HELP_TEXT content", () => {
    const action = router("help");
    if (action.kind !== "help") throw new Error("expected help");
    expect(action.text).toContain("Sprint Commands");
    expect(action.text).toContain("huddle");
    expect(action.text).toContain("GitHub Copilot");
  });

  // ── huddle ─────────────────────────────────────────────────────────────────

  it("routes 'huddle' to get_daily_huddle", () => {
    const action = router("huddle");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.server).toBe("jira");
    expect(action.tool).toBe("get_daily_huddle");
    expect(action.render).toBe("huddle");
  });

  it("is case-insensitive for huddle", () => {
    const action = router("HUDDLE");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.tool).toBe("get_daily_huddle");
  });

  // ── sprint ─────────────────────────────────────────────────────────────────

  it("routes 'sprint' to get_active_sprint", () => {
    const action = router("sprint");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.server).toBe("jira");
    expect(action.tool).toBe("get_active_sprint");
    expect(action.render).toBe("sprint");
  });

  // ── ticket ─────────────────────────────────────────────────────────────────

  it("routes 'ticket DEV-42' to get_ticket with ticketKey", () => {
    const action = router("ticket DEV-42");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.server).toBe("jira");
    expect(action.tool).toBe("get_ticket");
    expect(action.render).toBe("ticket");
    expect((action.input as { ticketKey: string }).ticketKey).toBe("DEV-42");
  });

  it("normalises ticket key to uppercase", () => {
    const action = router("ticket dev-42");
    if (action.kind !== "tool") throw new Error("expected tool");
    expect((action.input as { ticketKey: string }).ticketKey).toBe("DEV-42");
  });

  it("returns help for 'ticket INVALID-KEY-FORMAT' (lowercase letters in number part)", () => {
    const action = router("ticket invalidkey");
    expect(action.kind).toBe("help");
    if (action.kind !== "help") return;
    expect(action.text).toContain("doesn't look like a valid Jira key");
  });

  it("returns help for 'ticket' with no key", () => {
    const action = router("ticket");
    expect(action.kind).toBe("help");
  });

  it("accepts PO board keys like PO-1", () => {
    const action = router("ticket PO-1");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect((action.input as { ticketKey: string }).ticketKey).toBe("PO-1");
  });

  // ── enhance ────────────────────────────────────────────────────────────────

  it("routes 'enhance DEV-10 some notes' to update_ticket", () => {
    const action = router("enhance DEV-10 some notes about the feature");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.tool).toBe("update_ticket");
    expect(action.render).toBe("ticket-updated");
    const input = action.input as { ticketKey: string; description: string };
    expect(input.ticketKey).toBe("DEV-10");
    expect(input.description).toBe("some notes about the feature");
  });

  it("returns help for 'enhance' with no key", () => {
    const action = router("enhance");
    expect(action.kind).toBe("help");
  });

  it("returns help for 'enhance BADKEY notes'", () => {
    const action = router("enhance badkey notes");
    expect(action.kind).toBe("help");
  });

  // ── create ─────────────────────────────────────────────────────────────────

  it("routes 'create <desc>' to create action", () => {
    const action = router("create password reset via email");
    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.description).toBe("password reset via email");
    expect(action.render).toBe("ticket-pair");
  });

  it("is case-insensitive for create", () => {
    const action = router("CREATE some feature");
    expect(action.kind).toBe("create");
  });

  // ── prs ────────────────────────────────────────────────────────────────────

  it("routes 'prs' to list_prs", () => {
    const action = router("prs");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.server).toBe("github");
    expect(action.tool).toBe("list_prs");
    expect(action.render).toBe("pr-list");
  });

  it("is case-insensitive for prs", () => {
    const action = router("PRS");
    expect(action.kind).toBe("tool");
  });

  // ── link pr ────────────────────────────────────────────────────────────────

  it("routes 'link pr 47 DEV-99' to link_pr_to_ticket with ticketKey", () => {
    const action = router("link pr 47 DEV-99");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.server).toBe("github");
    expect(action.tool).toBe("link_pr_to_ticket");
    expect(action.render).toBe("link-result");
    const input = action.input as { number: number; ticketKey?: string };
    expect(input.number).toBe(47);
    expect(input.ticketKey).toBe("DEV-99");
  });

  it("routes 'link pr 12' without KEY (auto-detect)", () => {
    const action = router("link pr 12");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    const input = action.input as { number: number; ticketKey?: string };
    expect(input.number).toBe(12);
    expect(input.ticketKey).toBeUndefined();
  });

  it("returns help for 'link pr 1 BADKEY'", () => {
    const action = router("link pr 1 notakey");
    expect(action.kind).toBe("help");
  });

  // ── unknown input ──────────────────────────────────────────────────────────

  it("returns help for unrecognised commands", () => {
    const action = router("what is the weather today?");
    expect(action.kind).toBe("help");
    if (action.kind !== "help") return;
    expect(action.text).toContain("Unknown command");
    expect(action.text).toContain("GitHub Copilot");
  });

  it("returns help for empty input", () => {
    const action = router("");
    expect(action.kind).toBe("help");
  });

  it("returns help for whitespace-only input", () => {
    const action = router("   ");
    expect(action.kind).toBe("help");
  });

  it("trims whitespace from input before parsing", () => {
    const action = router("  sprint  ");
    expect(action.kind).toBe("tool");
    if (action.kind !== "tool") return;
    expect(action.tool).toBe("get_active_sprint");
  });
});

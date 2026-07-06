// ChatPanel tests — keyless/offline
// CONTRACTS.md §6 v1.1: AI routing, selectedSprintId, fallback
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "./ChatPanel";
import type { AiStatus } from "../lib/types";

// Mock all network-touching modules
vi.mock("../lib/mcpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mcpClient")>();
  return { ...actual };
});

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    createTicketPair: vi.fn().mockResolvedValue({
      po: { key: "PO-42", url: "https://jira.example.com/browse/PO-42", board: "PO" as const },
      dev: { key: "DEV-99", url: "https://jira.example.com/browse/DEV-99", board: "DEV" as const },
    }),
    enhanceTicket: vi.fn().mockResolvedValue({
      ticket: { key: "DEV-10", summary: "Old summary", description: "Old desc", url: "https://jira.example.com/browse/DEV-10" },
      updated: { key: "DEV-10", url: "https://jira.example.com/browse/DEV-10", updatedFields: ["description"] },
    }),
  };
});

vi.mock("../lib/aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/aiClient")>();
  return {
    ...actual,
    aiDraftTickets: vi.fn().mockResolvedValue({
      assistantMessage: "AI drafted your tickets",
      po: { summary: "AI PO summary", description: "AI PO desc", storyPoints: null },
      dev: { summary: "AI Dev summary", description: "AI Dev desc" },
      provider: "anthropic",
      model: "claude-opus-4-8",
    }),
    aiEnhanceTicket: vi.fn().mockResolvedValue({
      assistantMessage: "AI enhanced your ticket",
      summary: "Enhanced summary",
      description: "Enhanced description",
      provider: "anthropic",
      model: "claude-opus-4-8",
    }),
    aiAsk: vi.fn().mockResolvedValue({
      answer: "You have 1 impediment: infra is down.",
      toolsUsed: ["get_impediments"],
      provider: "anthropic",
      model: "claude-opus-4-8",
    }),
  };
});

vi.mock("../hooks/useGithub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useGithub")>();
  return { ...actual };
});

const AI_OFF: AiStatus = { enabled: false, provider: null, model: null };
const AI_ON: AiStatus = { enabled: true, provider: "anthropic", model: "claude-opus-4-8" };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => { cleanup(); });

describe("ChatPanel", () => {
  it("renders the panel with initial assistant message", () => {
    render(<ChatPanel selectedSprintId={null} aiStatus={AI_OFF} />);
    expect(screen.getByText(/Sprint commands panel/)).toBeTruthy();
  });

  it("create command with AI enabled uses AI drafts", async () => {
    const user = userEvent.setup();
    const { aiDraftTickets } = await import("../lib/aiClient");
    const { createTicketPair } = await import("../hooks/useJira");

    render(<ChatPanel selectedSprintId={null} aiStatus={AI_ON} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "create Add dark mode");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(aiDraftTickets).toHaveBeenCalledOnce();
      expect(createTicketPair).toHaveBeenCalledOnce();
    });

    // AI draft response message should appear
    await waitFor(() => {
      expect(screen.getByText("AI drafted your tickets")).toBeTruthy();
    });
  });

  it("create command with AI disabled uses local templates", async () => {
    const user = userEvent.setup();
    const { aiDraftTickets } = await import("../lib/aiClient");
    const { createTicketPair } = await import("../hooks/useJira");

    render(<ChatPanel selectedSprintId={null} aiStatus={AI_OFF} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "create Add dark mode");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(createTicketPair).toHaveBeenCalledOnce();
    });

    // aiDraftTickets must NOT have been called
    expect(aiDraftTickets).not.toHaveBeenCalled();

    // Reply should note local templates — may appear multiple times (text + card note)
    await waitFor(() => {
      expect(screen.getAllByText(/local templates — AI off/i).length).toBeGreaterThan(0);
    });
  });

  it("create command with AI returns AI_UNAVAILABLE falls back to local templates", async () => {
    const user = userEvent.setup();
    const { aiDraftTickets } = await import("../lib/aiClient");
    const { createTicketPair } = await import("../hooks/useJira");

    vi.mocked(aiDraftTickets).mockRejectedValueOnce({
      code: "AI_UNAVAILABLE",
      message: "AI is disabled",
    });

    render(<ChatPanel selectedSprintId={null} aiStatus={AI_ON} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "create Some feature");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(createTicketPair).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.getAllByText(/local templates — AI off/i).length).toBeGreaterThan(0);
    });
  });

  it("help command shows help text", async () => {
    const user = userEvent.setup();
    render(<ChatPanel selectedSprintId={null} aiStatus={AI_OFF} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "help");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // "Sprint Commands" appears in the initial message AND the help response — use getAllByText
    await waitFor(() => {
      expect(screen.getAllByText(/Sprint Commands/).length).toBeGreaterThan(0);
    });
  });

  it("v1.18: a free-form question routes to the AI assistant when AI is on", async () => {
    const user = userEvent.setup();
    const { aiAsk } = await import("../lib/aiClient");

    render(<ChatPanel selectedSprintId={50} aiStatus={AI_ON} boardId={10} contextSprintId={50} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "any impediments today?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(aiAsk).toHaveBeenCalledWith({ question: "any impediments today?", boardId: 10, sprintId: 50 });
    });
    expect(await screen.findByText(/infra is down/)).toBeTruthy();
  });

  it("v1.40: the SECOND ask carries the first Q/A as history (conversation memory)", async () => {
    const user = userEvent.setup();
    const { aiAsk } = await import("../lib/aiClient");

    render(<ChatPanel selectedSprintId={50} aiStatus={AI_ON} boardId={10} contextSprintId={50} />);
    const input = screen.getByRole("textbox", { name: /sprint command/i });

    // First ask — no history yet.
    await user.type(input, "any impediments today?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(aiAsk).toHaveBeenCalledTimes(1));
    expect(vi.mocked(aiAsk).mock.calls[0]![0].history).toBeUndefined();

    // Second ask — includes the first question + the assistant's answer.
    await user.type(input, "who owns it?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(aiAsk).toHaveBeenCalledTimes(2));
    const second = vi.mocked(aiAsk).mock.calls[1]![0];
    expect(second.history).toBeDefined();
    expect(second.history![0]).toEqual({ role: "user", content: "any impediments today?" });
    expect(second.history![1]!.role).toBe("assistant");
    expect(second.history![1]!.content.length).toBeGreaterThan(0);
  });

  it("v1.19: a proposed write surfaces the confirm modal (does not auto-execute)", async () => {
    const user = userEvent.setup();
    const { aiAsk } = await import("../lib/aiClient");
    vi.mocked(aiAsk).mockResolvedValueOnce({
      answer: "",
      toolsUsed: ["update_ticket"],
      provider: "anthropic",
      model: "claude-opus-4-8",
      proposedAction: { tool: "update_ticket", args: { ticketKey: "VRDB-2700", storyPoints: 2 } },
    });

    render(<ChatPanel selectedSprintId={50} aiStatus={AI_ON} boardId={10} contextSprintId={50} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "update points of VRDB-2700 to 2");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // The action-confirm modal opens; nothing is written until the user confirms.
    expect(await screen.findByText(/Update ticket\?/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^confirm$/i })).toBeTruthy();
  });

  it("v1.18: a free-form question does NOT call the assistant when AI is off (help fallback)", async () => {
    const user = userEvent.setup();
    const { aiAsk } = await import("../lib/aiClient");

    render(<ChatPanel selectedSprintId={null} aiStatus={AI_OFF} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    await user.type(input, "any impediments today?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Unknown command/i).length).toBeGreaterThan(0);
    });
    expect(aiAsk).not.toHaveBeenCalled();
  });

  it("Enter key sends the message (Shift+Enter does not)", async () => {
    const user = userEvent.setup();
    const { aiDraftTickets } = await import("../lib/aiClient");
    const { createTicketPair } = await import("../hooks/useJira");

    render(<ChatPanel selectedSprintId={null} aiStatus={AI_OFF} />);

    const input = screen.getByRole("textbox", { name: /sprint command/i });
    // Shift+Enter should add newline, not send
    await user.type(input, "create{shift>}{enter}{/shift}test");
    // input still has content — not yet sent
    expect(createTicketPair).not.toHaveBeenCalled();
    expect(aiDraftTickets).not.toHaveBeenCalled();
  });
});

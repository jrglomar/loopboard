import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicketGen } from "./TicketGen";

// Default test posture: AI disabled so legacy flows render (CONTRACTS.md §6 v1.1)
vi.mock("../lib/aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/aiClient")>();
  return {
    ...actual,
    getAiStatus: vi.fn().mockResolvedValue({ enabled: false, provider: null, model: null }),
    aiDraftTickets: vi.fn().mockRejectedValue({ code: "AI_UNAVAILABLE", message: "AI is off" }),
    aiEnhanceTicket: vi.fn().mockRejectedValue({ code: "AI_UNAVAILABLE", message: "AI is off" }),
  };
});

// v1.6 (ADR-017): mock boards.ts — default: boards null (older bridge / legacy fallback).
// This keeps existing v1.4 tests unchanged (single "Add to sprint" select renders).
// v1.6 board-specific tests override this per-test.
vi.mock("../lib/boards", () => ({
  useBoards: vi.fn().mockReturnValue({ boards: null, loading: false }),
  getBoards: vi.fn().mockResolvedValue(null),
}));

// Mock the createTicketPair and useSprintList so tests run without network
vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    createTicketPair: vi.fn().mockResolvedValue({
      po: { key: "PO-42", url: "https://jira.example.com/browse/PO-42", board: "PO" as const },
      dev: { key: "DEV-99", url: "https://jira.example.com/browse/DEV-99", board: "DEV" as const },
    }),
    createPoTicket: vi.fn().mockResolvedValue({
      key: "PO-42", url: "https://jira.example.com/browse/PO-42", board: "PO" as const,
    }),
    useSprintList: vi.fn().mockReturnValue({
      // v1.4: 1 active + 1 future sprint for target sprint selector tests
      data: {
        boardId: 1,
        active: [
          { id: 55, name: "Sprint 7", state: "active", startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z", completeDate: null, goal: null, boardId: 1 },
        ],
        future: [
          { id: 100, name: "Sprint 8", state: "future", startDate: "2026-06-15T00:00:00.000Z", endDate: "2026-06-28T00:00:00.000Z", completeDate: null, goal: null, boardId: 1 },
        ],
        closed: [],
      },
      loading: false,
      error: null,
      run: vi.fn(),
    }),
  };
});

// ── Import boards module for mock reset ───────────────────────────────────────
import * as boardsModule from "../lib/boards";

// v1.17 (ADR-028): TicketGen is PO-first by default. Pair tests opt in to the Dev task
// via the "Also create a linked Dev task" checkbox (present in form + AI modes).
function enableDevTask() {
  fireEvent.click(screen.getByRole("checkbox", { name: /Also create a linked Dev task/i }));
}

describe("TicketGen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // v1.6: restore boards mock to null default after clearAllMocks
    vi.mocked(boardsModule.useBoards).mockReturnValue({ boards: null, loading: false });
  });

  afterEach(() => { cleanup(); });

  it("renders the form initially (fallback mode when AI disabled)", async () => {
    render(<TicketGen />);
    // Wait for AI status check to complete and form to render
    await waitFor(() => {
      expect(screen.getByText("Ticket Generator")).toBeTruthy();
    });
    expect(screen.getByLabelText(/feature description/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /generate drafts/i })).toBeTruthy();
  });

  it("shows validation error when description is empty", async () => {
    render(<TicketGen />);
    await waitFor(() => screen.getByRole("button", { name: /generate drafts/i }));
    const generateBtn = screen.getByRole("button", { name: /generate drafts/i });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/required/i)).toBeTruthy();
    });
  });

  it("v1.17 (ADR-028): PO-first by default — creates only the PO story (no Dev pane/task)", async () => {
    const { createPoTicket, createTicketPair } = await import("../hooks/useJira");
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    await user.type(screen.getByLabelText(/feature description/i), "PO only feature");
    // NOTE: do NOT enable "Also create a linked Dev task"
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));

    // Only the PO Story pane shows
    await waitFor(() => expect(screen.getByText("PO Story")).toBeTruthy());
    expect(screen.queryByText("Dev Task")).toBeNull();

    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(vi.mocked(createPoTicket)).toHaveBeenCalledOnce();
      expect(vi.mocked(createTicketPair)).not.toHaveBeenCalled();
      expect(screen.getByText(/PO: PO-42/)).toBeTruthy();
    });
    // The success heading is singular and there is no Dev link
    expect(screen.queryByText(/DEV:/)).toBeNull();
  });

  it("shows draft previews after entering description and clicking generate", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    const textarea = screen.getByLabelText(/feature description/i);
    await user.type(textarea, "Password reset via email");
    enableDevTask();

    const generateBtn = screen.getByRole("button", { name: /generate drafts/i });
    await user.click(generateBtn);

    // Draft preview should now show PO Story and Dev Task badges
    await waitFor(() => {
      expect(screen.getByText("PO Story")).toBeTruthy();
      expect(screen.getByText("Dev Task")).toBeTruthy();
    });
  });

  it("populates PO summary field in the preview", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    const textarea = screen.getByLabelText(/feature description/i);
    await user.type(textarea, "Single sign-on via GitHub");
    enableDevTask();

    await user.click(screen.getByRole("button", { name: /generate drafts/i }));

    await waitFor(() => {
      // Summary fields are inputs in the preview
      const summaryInputs = screen
        .getAllByRole("textbox")
        .filter((el) => (el as HTMLInputElement).tagName === "INPUT");
      // There are 2 summary inputs in preview (PO + Dev)
      expect(summaryInputs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows 'Create in Jira' button in preview", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    await user.type(screen.getByLabelText(/feature description/i), "Feature X");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create in jira/i })).toBeTruthy();
    });
  });

  it("allows going Back from preview to form", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    await user.type(screen.getByLabelText(/feature description/i), "Feature X");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));

    // Find the "Back" button specifically (not the dismiss banner button)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("button", { name: /generate drafts/i })).toBeTruthy();
  });

  it("shows success panel with ticket links after creating", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    await user.type(screen.getByLabelText(/feature description/i), "Feature Z");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));

    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeTruthy();
      expect(screen.getByText(/Tickets created in Jira/i)).toBeTruthy();
    });
  });

  it("shows both PO and Dev ticket links in success panel", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    await user.type(screen.getByLabelText(/feature description/i), "Feature Z");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(screen.getByText(/PO: PO-42/)).toBeTruthy();
      expect(screen.getByText(/DEV: DEV-99/)).toBeTruthy();
    });
  });

  it("resets to form when 'Create another' is clicked in success state", async () => {
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    await user.type(screen.getByLabelText(/feature description/i), "Feature Z");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));
    await waitFor(() => screen.getByRole("button", { name: /create another/i }));

    await user.click(screen.getByRole("button", { name: /create another/i }));

    // After reset, wait for AI status to resolve again and show the form
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /generate drafts/i })).toBeTruthy();
    });
  });

  // ── AI mode tests ─────────────────────────────────────────────────────────

  it("shows AI chat layout when getAiStatus returns enabled", async () => {
    const { getAiStatus, aiDraftTickets } = await import("../lib/aiClient");
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: true,
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
    vi.mocked(aiDraftTickets).mockResolvedValueOnce({
      assistantMessage: "Here are your drafts",
      po: { summary: "PO: Test feature", description: "PO desc", storyPoints: null },
      dev: { summary: "Dev: Implement test feature", description: "Dev desc" },
      provider: "anthropic",
      model: "claude-opus-4-8",
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    // Wait for AI mode to activate — should show AI badge
    await waitFor(() => {
      expect(screen.getByText(/AI: anthropic/)).toBeTruthy();
    });

    // Type and send a message
    const aiInput = screen.getByLabelText(/describe the feature/i);
    await user.type(aiInput, "Add dark mode");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Should show assistant bubble + draft cards
    await waitFor(() => {
      expect(screen.getByText("Here are your drafts")).toBeTruthy();
      expect(screen.getByText("PO Story")).toBeTruthy();
      expect(screen.getByText("Dev Task")).toBeTruthy();
    });
  });

  it("v1.12: draft preview has a Regenerate control that re-drafts from a comment", async () => {
    const { getAiStatus, aiDraftTickets } = await import("../lib/aiClient");
    vi.mocked(getAiStatus).mockResolvedValueOnce({ enabled: true, provider: "github", model: "m" });
    vi.mocked(aiDraftTickets)
      .mockResolvedValueOnce({
        assistantMessage: "v1", po: { summary: "PO v1", description: "d", storyPoints: null },
        dev: { summary: "Dev v1", description: "d" }, provider: "github", model: "m",
      })
      .mockResolvedValueOnce({
        assistantMessage: "v2", po: { summary: "PO v2 refined", description: "d", storyPoints: null },
        dev: { summary: "Dev v2 refined", description: "d" }, provider: "github", model: "m",
      });

    const user = userEvent.setup();
    render(<TicketGen />);
    await waitFor(() => expect(screen.getByText(/AI: github/)).toBeTruthy());

    await user.type(screen.getByLabelText(/describe the feature/i), "Build login");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByDisplayValue("PO v1")).toBeTruthy());

    // Comment + Regenerate → re-draft from the comment
    await user.type(screen.getByLabelText(/Comment to refine the draft/i), "add 2FA");
    await user.click(screen.getByRole("button", { name: /Regenerate/i }));

    await waitFor(() => {
      const calls = vi.mocked(aiDraftTickets).mock.calls;
      const last = calls[calls.length - 1]![0];
      expect(last.messages[last.messages.length - 1]).toMatchObject({ role: "user", content: "add 2FA" });
    });
    expect(await screen.findByDisplayValue("PO v2 refined")).toBeTruthy();
  });

  it("switches to fallback when AI_UNAVAILABLE on send", async () => {
    const { getAiStatus, aiDraftTickets } = await import("../lib/aiClient");
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: true,
      provider: "github",
      model: "openai/gpt-4o-mini",
    });
    vi.mocked(aiDraftTickets).mockRejectedValueOnce({
      code: "AI_UNAVAILABLE",
      message: "AI drafting is disabled",
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => {
      expect(screen.getByText(/AI: github/)).toBeTruthy();
    });

    const aiInput = screen.getByLabelText(/describe the feature/i);
    await user.type(aiInput, "New feature");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // v1.2: when AI was available but got AI_UNAVAILABLE → forceFallback mode
    // Banner says "Using local templates. AI drafting is available." + "Use AI drafting" button
    await waitFor(() => {
      expect(screen.getByText(/Using local templates/i)).toBeTruthy();
    });
    // "Use AI drafting" buttons appear in header AND banner (both match same aria-label)
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /use ai drafting/i }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders the fallback form when AI status is disabled", async () => {
    // getAiStatus already mocked to return disabled in beforeEach
    render(<TicketGen />);

    await waitFor(() => {
      expect(screen.getByLabelText(/feature description/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /generate drafts/i })).toBeTruthy();
    });
  });

  // ── v1.2: "Use AI drafting" toggle tests ─────────────────────────────────

  it("does NOT show 'Use AI drafting' button when AI is genuinely disabled", async () => {
    // getAiStatus returns disabled (the default mock) — no toggle button should appear
    render(<TicketGen />);

    await waitFor(() => {
      expect(screen.getByLabelText(/feature description/i)).toBeTruthy();
    });

    // No "Use AI drafting" button when AI_PROVIDER is unset
    expect(screen.queryByRole("button", { name: /use ai drafting/i })).toBeNull();
  });

  it("shows 'Use AI drafting' button in fallback when AI was available before force-fallback", async () => {
    const { getAiStatus, aiDraftTickets } = await import("../lib/aiClient");
    // First call: AI enabled
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: true,
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
    // Sending fails with AI_UNAVAILABLE → triggers forceFallback
    vi.mocked(aiDraftTickets).mockRejectedValueOnce({
      code: "AI_UNAVAILABLE",
      message: "AI drafting is disabled",
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => {
      expect(screen.getByText(/AI: anthropic/)).toBeTruthy();
    });

    // Send a message to trigger AI_UNAVAILABLE → force fallback
    const aiInput = screen.getByLabelText(/describe the feature/i);
    await user.type(aiInput, "Test feature");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Now in fallback but AI was available → "Use AI drafting" buttons appear (header + banner)
    await waitFor(() => {
      const useAiBtns = screen.getAllByRole("button", { name: /use ai drafting/i });
      expect(useAiBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("clicking 'Use AI drafting' re-checks AI status and returns to AI mode when enabled", async () => {
    const { getAiStatus, aiDraftTickets } = await import("../lib/aiClient");
    // First call on mount: AI enabled
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: true,
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
    // Send fails with AI_UNAVAILABLE
    vi.mocked(aiDraftTickets).mockRejectedValueOnce({
      code: "AI_UNAVAILABLE",
      message: "AI drafting is disabled",
    });
    // Second getAiStatus call (from handleUseAiDrafting): AI is enabled again
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: true,
      provider: "anthropic",
      model: "claude-opus-4-8",
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => {
      expect(screen.getByText(/AI: anthropic/)).toBeTruthy();
    });

    // Trigger force-fallback via AI_UNAVAILABLE
    const aiInput = screen.getByLabelText(/describe the feature/i);
    await user.type(aiInput, "Test feature");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Wait for fallback mode — both header and banner have the button
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /use ai drafting/i }).length).toBeGreaterThanOrEqual(1);
    });

    // Click the first "Use AI drafting" button
    const useAiBtn = screen.getAllByRole("button", { name: /use ai drafting/i })[0];
    await user.click(useAiBtn);

    // Should return to AI mode — AI badge should appear again
    await waitFor(() => {
      expect(screen.getByText(/AI: anthropic/)).toBeTruthy();
    });
  });

  // ── v1.4: Target sprint tests (ADR-011) ────────────────────────────────────

  it("renders the 'Add to sprint' select with Active and Future optgroups", async () => {
    render(<TicketGen />);
    // Wait for the form to render (AI disabled = fallback mode)
    await waitFor(() => screen.getByRole("button", { name: /generate drafts/i }));

    // The sprint select should be rendered with options from mock sprint list
    const sprintSelect = screen.getByRole("combobox", { name: /add to sprint/i });
    expect(sprintSelect).toBeTruthy();

    // "Backlog / no sprint" is the default
    expect((sprintSelect as HTMLSelectElement).value).toBe("");

    // Should have Active and Future optgroups
    const activeGroup = sprintSelect.querySelector("optgroup[label='Active']");
    const futureGroup = sprintSelect.querySelector("optgroup[label='Future']");
    expect(activeGroup).toBeTruthy();
    expect(futureGroup).toBeTruthy();
    expect(activeGroup?.querySelector("option")?.textContent).toContain("Sprint 7");
    expect(futureGroup?.querySelector("option")?.textContent).toContain("Sprint 8");
  });

  it("passes sprintId to createTicketPair when a sprint is selected", async () => {
    const { createTicketPair } = await import("../hooks/useJira");
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));

    // Select a sprint
    const sprintSelect = screen.getByRole("combobox", { name: /add to sprint/i });
    fireEvent.change(sprintSelect, { target: { value: "100" } });

    // Fill and generate
    await user.type(screen.getByLabelText(/feature description/i), "Feature X");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));

    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(vi.mocked(createTicketPair)).toHaveBeenCalledOnce();
      const callArg = vi.mocked(createTicketPair).mock.calls[0][0];
      expect(callArg.dev.sprintId).toBe(100);
      expect(callArg.po.sprintId).toBe(100);
    });
  });

  it("shows target sprint name in success panel when sprint selected", async () => {
    const { createTicketPair } = await import("../hooks/useJira");
    vi.mocked(createTicketPair).mockResolvedValueOnce({
      po: { key: "PO-42", url: "https://jira.example.com/browse/PO-42", board: "PO" as const },
      dev: { key: "DEV-99", url: "https://jira.example.com/browse/DEV-99", board: "DEV" as const },
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));

    // Select future sprint (Sprint 8, id=100)
    fireEvent.change(screen.getByRole("combobox", { name: /add to sprint/i }), { target: { value: "100" } });

    await user.type(screen.getByLabelText(/feature description/i), "Feature Z");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      // Success panel should mention the sprint name
      expect(screen.getByText(/Added to sprint/i)).toBeTruthy();
      expect(screen.getByText(/Sprint 8/)).toBeTruthy();
    });
  });

  it("shows sprintWarning in success panel when dev ticket warns about sprint", async () => {
    const { createTicketPair } = await import("../hooks/useJira");
    vi.mocked(createTicketPair).mockResolvedValueOnce({
      po: { key: "PO-42", url: "https://jira.example.com/browse/PO-42", board: "PO" as const },
      dev: {
        key: "DEV-99",
        url: "https://jira.example.com/browse/DEV-99",
        board: "DEV" as const,
        sprintWarning: "Project PO is not on this board's sprint",
      },
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));

    // Select a sprint
    fireEvent.change(screen.getByRole("combobox", { name: /add to sprint/i }), { target: { value: "55" } });

    await user.type(screen.getByLabelText(/feature description/i), "Feature with warning");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      // Success still shown (ticket WAS created)
      expect(screen.getByText(/Tickets created in Jira/i)).toBeTruthy();
      // Warning shown subtly
      expect(screen.getByText(/Project PO is not on this board/i)).toBeTruthy();
    });
  });

  it("does NOT pass sprintId when Backlog is selected (default)", async () => {
    const { createTicketPair } = await import("../hooks/useJira");
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    // Default: "Backlog / no sprint" — no change to select

    await user.type(screen.getByLabelText(/feature description/i), "Feature Y");
    enableDevTask();
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(vi.mocked(createTicketPair)).toHaveBeenCalledOnce();
      const callArg = vi.mocked(createTicketPair).mock.calls[0][0];
      expect(callArg.dev.sprintId).toBeUndefined();
      expect(callArg.po.sprintId).toBeUndefined();
    });
  });

  // ── v1.6: Two-sprint PO/Dev select tests (ADR-017) ──────────────────────────

  it("v1.6: renders separate PO sprint and Dev sprint selects when boards is available", async () => {
    const { useBoards } = await import("../lib/boards");
    vi.mocked(useBoards).mockReturnValue({
      boards: { dev: [{ id: 10, projectKey: "DEV" }], po: [{ id: 20, projectKey: "PO" }] },
      loading: false,
    });

    render(<TicketGen />);
    await waitFor(() => screen.getByRole("button", { name: /generate drafts/i }));
    enableDevTask();

    // Two separate selects for PO and Dev
    const poSelect = screen.getByRole("combobox", { name: /po story sprint/i });
    const devSelect = screen.getByRole("combobox", { name: /dev task sprint/i });
    expect(poSelect).toBeTruthy();
    expect(devSelect).toBeTruthy();

    // No single "Add to sprint" combobox when boards is available
    expect(screen.queryByRole("combobox", { name: /^add to sprint$/i })).toBeNull();
  });

  it("v1.6: passes separate PO and Dev sprint ids to createTicketPair", async () => {
    const { useBoards } = await import("../lib/boards");
    vi.mocked(useBoards).mockReturnValue({
      boards: { dev: [{ id: 10, projectKey: "DEV" }], po: [{ id: 20, projectKey: "PO" }] },
      loading: false,
    });

    const { createTicketPair } = await import("../hooks/useJira");
    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    enableDevTask();

    // Select PO sprint (Sprint 7 = id 55)
    const poSelect = screen.getByRole("combobox", { name: /po story sprint/i });
    fireEvent.change(poSelect, { target: { value: "55" } });

    // Select Dev sprint (Sprint 8 = id 100)
    const devSelect = screen.getByRole("combobox", { name: /dev task sprint/i });
    fireEvent.change(devSelect, { target: { value: "100" } });

    await user.type(screen.getByLabelText(/feature description/i), "Two-board feature");
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(vi.mocked(createTicketPair)).toHaveBeenCalledOnce();
      const args = vi.mocked(createTicketPair).mock.calls[0][0];
      // PO story gets the PO sprint id
      expect(args.po.sprintId).toBe(55);
      // Dev task gets the Dev sprint id
      expect(args.dev.sprintId).toBe(100);
    });
  });

  it("v1.6: shows PO and Dev sprint names in success panel", async () => {
    const { useBoards } = await import("../lib/boards");
    vi.mocked(useBoards).mockReturnValue({
      boards: { dev: [{ id: 10, projectKey: "DEV" }], po: [{ id: 20, projectKey: "PO" }] },
      loading: false,
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => screen.getByLabelText(/feature description/i));
    enableDevTask();

    const poSelect = screen.getByRole("combobox", { name: /po story sprint/i });
    fireEvent.change(poSelect, { target: { value: "55" } });
    const devSelect = screen.getByRole("combobox", { name: /dev task sprint/i });
    fireEvent.change(devSelect, { target: { value: "100" } });

    await user.type(screen.getByLabelText(/feature description/i), "Feature with sprints");
    await user.click(screen.getByRole("button", { name: /generate drafts/i }));
    await waitFor(() => screen.getByRole("button", { name: /create in jira/i }));
    await user.click(screen.getByRole("button", { name: /create in jira/i }));

    await waitFor(() => {
      expect(screen.getByText(/PO story → sprint/i)).toBeTruthy();
      expect(screen.getByText(/Dev task → sprint/i)).toBeTruthy();
      // Sprint names from the mocked sprint list
      expect(screen.getByText("Sprint 7")).toBeTruthy();
      expect(screen.getByText("Sprint 8")).toBeTruthy();
    });
  });

  it("v1.6: falls back to single 'Add to sprint' select when boards is null", async () => {
    // boards is null by default (see vi.mock at top of file)
    render(<TicketGen />);
    await waitFor(() => screen.getByRole("button", { name: /generate drafts/i }));

    // Single "Add to sprint" select present (legacy v1.4 behavior)
    const sprintSelect = screen.getByRole("combobox", { name: /add to sprint/i });
    expect(sprintSelect).toBeTruthy();
  });

  it("clicking 'Use AI drafting' shows disabled banner when AI re-check returns disabled", async () => {
    const { getAiStatus, aiDraftTickets } = await import("../lib/aiClient");
    // First call: AI enabled
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: true,
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
    // Send fails
    vi.mocked(aiDraftTickets).mockRejectedValueOnce({
      code: "AI_UNAVAILABLE",
      message: "AI drafting is disabled",
    });
    // Second getAiStatus call: still disabled
    vi.mocked(getAiStatus).mockResolvedValueOnce({
      enabled: false,
      provider: null,
      model: null,
    });

    const user = userEvent.setup();
    render(<TicketGen />);

    await waitFor(() => {
      expect(screen.getByText(/AI: anthropic/)).toBeTruthy();
    });

    const aiInput = screen.getByLabelText(/describe the feature/i);
    await user.type(aiInput, "Test feature");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // In force-fallback: both header and banner show "Use AI drafting"
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /use ai drafting/i }).length).toBeGreaterThanOrEqual(1);
    });

    // Click the first "Use AI drafting"
    const useAiBtn = screen.getAllByRole("button", { name: /use ai drafting/i })[0];
    await user.click(useAiBtn);

    // AI re-check returned disabled → now aiGenuinelyDisabled = true
    // Shows the instructions-only banner: "AI drafting is off — using local templates."
    await waitFor(() => {
      expect(screen.getByText(/AI drafting is off/i)).toBeTruthy();
    });
    // No "Use AI drafting" button — genuinely disabled shows instructions banner only
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /use ai drafting/i })).toBeNull();
    });
  });
});

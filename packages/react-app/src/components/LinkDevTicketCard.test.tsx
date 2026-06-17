// LinkDevTicketCard tests — v1.10, ADR-021
// Keyless/offline — useBoards, useSprintList, useActiveSprint, createLinkedDevTicket,
// and aiClient are all mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LinkDevTicketCard } from "./LinkDevTicketCard";

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useSprintList: vi.fn(),
    useActiveSprint: vi.fn(),
    createLinkedDevTicket: vi.fn(),
  };
});

vi.mock("../lib/boards", () => ({ useBoards: vi.fn() }));
vi.mock("../lib/aiClient", () => ({
  getAiStatus: vi.fn(),
  aiDraftTickets: vi.fn(),
}));

import * as useJiraModule from "../hooks/useJira";
import * as boardsModule from "../lib/boards";
import * as aiClientModule from "../lib/aiClient";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BOARDS = { dev: { id: 10, projectKey: "VRDB" }, po: { id: 20, projectKey: "VBPO" } };

const PO_SPRINTS = {
  active: [{ id: 200, name: "PO Sprint A", state: "active" as const, startDate: null, endDate: null, goal: null }],
  future: [],
  closed: [],
};
const DEV_SPRINTS = {
  active: [{ id: 300, name: "Dev Sprint A", state: "active" as const, startDate: null, endDate: null, goal: null }],
  future: [],
  closed: [],
};

const PO_ISSUE = {
  key: "VBPO-1",
  summary: "As a user I want password reset",
  status: "To Do",
  statusCategory: "todo" as const,
  assignee: null,
  assigneeAccountId: null,
  storyPoints: 5,
  issueType: "Story",
  url: "https://jira.example.com/browse/VBPO-1",
  blocked: false,
};

const SPRINT_DATA = {
  sprint: { id: 200, name: "PO Sprint A", state: "active" as const, startDate: null, endDate: null, goal: null },
  activeSprints: [],
  futureSprints: [],
  issuesByStatus: { todo: [PO_ISSUE], inprogress: [], codereview: [], done: [] },
  totals: {
    total: 1, todo: 1, inprogress: 0, codereview: 0, done: 0, blocked: 0,
    storyPointsTotal: 5, storyPointsDone: 0, storyPointsCodeReview: 0,
  },
};

function setMocks() {
  vi.mocked(boardsModule.useBoards).mockReturnValue({ boards: BOARDS, loading: false, error: null } as never);

  // useSprintList(state, boardId) → PO list for board 20, Dev list for board 10
  vi.mocked(useJiraModule.useSprintList).mockImplementation((_state: unknown, boardId?: number) => {
    const data = boardId === 20 ? PO_SPRINTS : DEV_SPRINTS;
    return { data, loading: false, error: null, run: vi.fn() } as never;
  });

  vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
    data: SPRINT_DATA, loading: false, error: null, run: vi.fn(),
  } as never);

  vi.mocked(aiClientModule.getAiStatus).mockResolvedValue({ enabled: false, provider: null, model: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  setMocks();
});
afterEach(() => cleanup());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LinkDevTicketCard (v1.10)", () => {
  it("renders the PO sprint + PO story selectors", () => {
    render(<LinkDevTicketCard />);
    expect(screen.getByRole("combobox", { name: /PO board sprint/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /PO story to link/i })).toBeTruthy();
  });

  it("picking a PO story pre-seeds the Dev summary from it", async () => {
    render(<LinkDevTicketCard />);
    fireEvent.change(screen.getByRole("combobox", { name: /PO board sprint/i }), { target: { value: "200" } });
    fireEvent.change(screen.getByRole("combobox", { name: /PO story to link/i }), { target: { value: "VBPO-1" } });

    const devSummary = (await screen.findByLabelText(/Dev summary/i)) as HTMLInputElement;
    expect(devSummary.value).toContain("As a user I want password reset");
  });

  it("Create calls create_dev_ticket with linkedPoTicketKey + the Dev sprint, then shows success", async () => {
    vi.mocked(useJiraModule.createLinkedDevTicket).mockResolvedValue({
      key: "DEV-99",
      url: "https://jira.example.com/browse/DEV-99",
      board: "DEV",
      linkedTo: "VBPO-1",
      sprintId: 300,
    } as never);

    render(<LinkDevTicketCard />);
    fireEvent.change(screen.getByRole("combobox", { name: /PO board sprint/i }), { target: { value: "200" } });
    fireEvent.change(screen.getByRole("combobox", { name: /PO story to link/i }), { target: { value: "VBPO-1" } });
    await screen.findByLabelText(/Dev summary/i);
    fireEvent.change(screen.getByRole("combobox", { name: /Dev board sprint/i }), { target: { value: "300" } });

    fireEvent.click(screen.getByRole("button", { name: /Create Dev ticket/i }));

    await waitFor(() => {
      expect(vi.mocked(useJiraModule.createLinkedDevTicket)).toHaveBeenCalledWith(
        expect.objectContaining({ linkedPoTicketKey: "VBPO-1", sprintId: 300 })
      );
    });
    // Success panel shows the new Dev ticket + the linked PO key
    expect(await screen.findByRole("link", { name: /Open DEV-99 in Jira/i })).toBeTruthy();
    expect(screen.getByText(/linked to/i)).toBeTruthy();
  });

  it("does not show 'Generate with AI' when AI is disabled", async () => {
    render(<LinkDevTicketCard />);
    fireEvent.change(screen.getByRole("combobox", { name: /PO board sprint/i }), { target: { value: "200" } });
    fireEvent.change(screen.getByRole("combobox", { name: /PO story to link/i }), { target: { value: "VBPO-1" } });
    await screen.findByLabelText(/Dev summary/i);
    expect(screen.queryByRole("button", { name: /Generate the Dev task with AI/i })).toBeNull();
  });
});

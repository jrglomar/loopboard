// Linking page tests — v1.11, ADR-022. Keyless/offline (all clients/hooks mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Linking } from "./Linking";

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
vi.mock("../lib/linkClient", () => ({ getLinkedIssues: vi.fn() }));
vi.mock("../lib/aiClient", () => ({ getAiStatus: vi.fn(), aiPlanDevTickets: vi.fn() }));

import * as useJiraModule from "../hooks/useJira";
import * as boardsModule from "../lib/boards";
import * as linkClientModule from "../lib/linkClient";
import * as aiClientModule from "../lib/aiClient";

const BOARDS = { dev: { id: 10, projectKey: "VRDB" }, po: { id: 20, projectKey: "VBPO" } };
const PO_SPRINTS = { active: [{ id: 200, name: "PO S", state: "active" as const, startDate: null, endDate: null, goal: null }], future: [], closed: [] };
const DEV_SPRINTS = { active: [{ id: 300, name: "Dev S", state: "active" as const, startDate: null, endDate: null, goal: null }], future: [], closed: [] };

const mkIssue = (key: string, summary: string) => ({
  key, summary, status: "To Do", statusCategory: "todo" as const,
  assignee: null, assigneeAccountId: null, storyPoints: 3, issueType: "Story",
  url: `https://jira/browse/${key}`, blocked: false,
});

const SPRINT_DATA = {
  sprint: { id: 200, name: "PO S", state: "active" as const, startDate: null, endDate: null, goal: null },
  activeSprints: [], futureSprints: [],
  issuesByStatus: { todo: [mkIssue("PO-1", "Already linked story"), mkIssue("PO-2", "Needs a dev task")], inprogress: [], codereview: [], done: [] },
  totals: { total: 2, todo: 2, inprogress: 0, codereview: 0, done: 0, blocked: 0, storyPointsTotal: 6, storyPointsDone: 0, storyPointsCodeReview: 0 },
};

function setMocks() {
  vi.mocked(boardsModule.useBoards).mockReturnValue({ boards: BOARDS, loading: false, error: null } as never);
  vi.mocked(useJiraModule.useSprintList).mockImplementation((_s: unknown, boardId?: number) =>
    ({ data: boardId === 20 ? PO_SPRINTS : DEV_SPRINTS, loading: false, error: null, run: vi.fn() } as never));
  vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({ data: SPRINT_DATA, loading: false, error: null, run: vi.fn() } as never);
  // PO-1 already has DEV-5; PO-2 has none
  vi.mocked(linkClientModule.getLinkedIssues).mockResolvedValue({
    links: { "PO-1": [{ key: "DEV-5", summary: "x", status: "Done", url: "u" }], "PO-2": [] },
  });
  vi.mocked(aiClientModule.getAiStatus).mockResolvedValue({ enabled: false, provider: null, model: null });
}

beforeEach(() => { vi.clearAllMocks(); setMocks(); });
afterEach(() => cleanup());

describe("Linking page (v1.11)", () => {
  it("renders the PO + Dev sprint selectors", () => {
    render(<Linking />);
    expect(screen.getByRole("combobox", { name: /PO board sprint/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Dev board sprint/i })).toBeTruthy();
  });

  it("lists PO tickets with existing-link badges and auto-selects link-less ones", async () => {
    render(<Linking />);
    fireEvent.change(screen.getByRole("combobox", { name: /PO board sprint/i }), { target: { value: "200" } });

    // PO-1 badged with its existing Dev link; PO-2 badged "no Dev link"
    expect(await screen.findByText(/→ DEV-5/)).toBeTruthy();
    // After links load, PO-2 (link-less) is auto-selected, PO-1 is not
    await waitFor(() => {
      const cbPo2 = screen.getByRole("checkbox", { name: /Select PO-2/i }) as HTMLInputElement;
      expect(cbPo2.checked).toBe(true);
    });
    expect((screen.getByRole("checkbox", { name: /Select PO-1/i }) as HTMLInputElement).checked).toBe(false);
  });

  it("plan (AI off) → Create all loops create_dev_ticket and logs the created Dev ticket", async () => {
    vi.mocked(useJiraModule.createLinkedDevTicket).mockResolvedValue({
      key: "DEV-99", url: "https://jira/browse/DEV-99", board: "DEV", linkedTo: "PO-2", sprintId: 300,
    } as never);

    render(<Linking />);
    fireEvent.change(screen.getByRole("combobox", { name: /PO board sprint/i }), { target: { value: "200" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Dev board sprint/i }), { target: { value: "300" } });
    await screen.findByText(/→ DEV-5/);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Select PO-2/i }) as HTMLInputElement).checked).toBe(true));

    // AI off → "Build plan (1)"
    fireEvent.click(screen.getByRole("button", { name: /Build plan/i }));

    // Plan phase: one editable item for PO-2
    expect(await screen.findByText(/Plan — 1 Dev task/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Create all/i }));

    await waitFor(() => {
      expect(vi.mocked(useJiraModule.createLinkedDevTicket)).toHaveBeenCalledWith(
        expect.objectContaining({ linkedPoTicketKey: "PO-2", sprintId: 300 })
      );
    });
    // Status log shows the created Dev ticket + summary
    expect(await screen.findByRole("link", { name: /Open DEV-99 in Jira/i })).toBeTruthy();
    expect(await screen.findByText(/1 created/i)).toBeTruthy();
  });
});

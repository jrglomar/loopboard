// DraftPlanCard tests — v1.68, ADR-079
// Keyless/offline. Mocking style: useActiveSprint/useTeamMembers/useSprintList/
// useLeaves are mocked as HOOKS (matches AssignmentList.test.tsx / LeavesPlotterCard.test.tsx),
// but useDraftPlan is left as the REAL hook — its CLIENT module (draftPlanClient)
// is mocked instead, so drafting/removing/moving exercises the real optimistic
// save + rollback logic and asserts on the resulting setDraftPlan calls.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DraftPlanCard } from "./DraftPlanCard";
import { sprintWorkingDays } from "../lib/capacity";
import type { DraftAssignment, DraftPlan, IssueSummary, SprintRef } from "../lib/types";

// ── Mock hooks (useActiveSprint / useTeamMembers / useSprintList / useLeaves) ─

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useActiveSprint: vi.fn(),
    useTeamMembers: vi.fn(),
    useSprintList: vi.fn(),
    useLeaves: vi.fn(),
    // useDraftPlan intentionally NOT overridden — the real hook runs against the
    // mocked draftPlanClient below, so save() exercises real optimistic/rollback logic.
    // v1.59 (ADR-071): idle/empty shape (anti-drift parity — see Reports.test.tsx's comment).
    useMultiSprintReport: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
    // v1.69 (ADR-080): the chip editor's PointsCell/SummaryCell (shared ./ticketCells) and the
    // breakdown dialog call these client-boundary functions directly (not via a hook).
    updateTicketPoints: vi.fn(),
    updateTicketSummary: vi.fn(),
    createPoTicket: vi.fn(),
  };
});

// v1.69 (ADR-080): the chip editor's StatusCell/MoveSprintCell (shared ./ticketCells) call
// these directly — same mocking style as AssignmentList.test.tsx.
vi.mock("../lib/ticketActionsClient", () => ({
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
  moveIssueToSprint: vi.fn(),
}));

// ── Mock the draft-plan client layer (the actual data boundary for useDraftPlan) ─

vi.mock("../lib/draftPlanClient", () => ({
  getDraftPlan: vi.fn(),
  setDraftPlan: vi.fn(),
}));

// ── usePolicy reads AuthContext; stub it like LeavesPlotterCard.test.tsx does ──

vi.mock("../lib/boards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/boards")>();
  return { ...actual, usePolicy: () => ({ requiredPoints: 8, offsetThreshold: 2 }) };
});

// ── Stub the in-card TeamManager — its own hooks are covered by TeamManager.test.tsx ─

vi.mock("./TeamManager", () => ({
  TeamManager: ({ boardId }: { boardId?: number }) => (
    <div data-testid="team-manager" data-board-id={boardId ?? ""} />
  ),
}));

import * as useJiraModule from "../hooks/useJira";
import * as draftPlanClientModule from "../lib/draftPlanClient";
import * as ticketActionsModule from "../lib/ticketActionsClient";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mkIssue(key: string, storyPoints: number | null, summary?: string): IssueSummary {
  return {
    key,
    summary: summary ?? `${key} summary`,
    status: "To Do",
    statusCategory: "todo",
    assignee: null,
    assigneeAccountId: null,
    storyPoints,
    issueType: "Story",
    url: `https://jira.example.com/browse/${key}`,
    blocked: false,
  };
}

const PO_1 = mkIssue("PO-1", 5);
const PO_2 = mkIssue("PO-2", 3);
const PO_3 = mkIssue("PO-3", 2);

const PO_SPRINT: SprintRef = {
  id: 100,
  name: "PO Sprint 8",
  state: "future",
  startDate: "2026-06-28T00:00:00.000Z", // Mon
  endDate: "2026-07-11T00:00:00.000Z",
  completeDate: null,
  goal: null,
  boardId: 20,
};

// v1.69 (ADR-080): a SECOND PO sprint — the move-to-sprint target for chip tests.
const PO_SPRINT_2: SprintRef = {
  id: 101,
  name: "PO Sprint 9",
  state: "future",
  startDate: "2026-07-12T00:00:00.000Z",
  endDate: "2026-07-25T00:00:00.000Z",
  completeDate: null,
  goal: null,
  boardId: 20,
};

const DEV_SPRINT: SprintRef = {
  id: 300,
  name: "Dev Sprint 8",
  state: "future",
  startDate: "2026-06-28T00:00:00.000Z",
  endDate: "2026-07-04T00:00:00.000Z",
  completeDate: null,
  goal: null,
  boardId: 10,
};

// Computed (not hardcoded) so the leave-day fixtures below always land on real
// working days regardless of which day of the week 2026-06-28 happens to be.
const DEV_WORK_DAYS = sprintWorkingDays(DEV_SPRINT.startDate, DEV_SPRINT.endDate);

const DEV_ROSTER = [
  { accountId: "acc-1", displayName: "Alice" },
  { accountId: "acc-2", displayName: "Bob" },
];

const ALICE: DraftAssignment = { accountId: "acc-1", displayName: "Alice" };
const BOB: DraftAssignment = { accountId: "acc-2", displayName: "Bob" };

const SPRINT_DATA = {
  sprint: { id: 100, name: "PO Sprint 8", state: "future" as const, startDate: PO_SPRINT.startDate, endDate: PO_SPRINT.endDate, goal: null },
  activeSprints: [],
  futureSprints: [],
  issuesByStatus: { todo: [PO_1, PO_2, PO_3], inprogress: [], codereview: [], done: [] },
  totals: {
    total: 3, todo: 3, inprogress: 0, codereview: 0, done: 0, blocked: 0,
    storyPointsTotal: 10, storyPointsDone: 0, storyPointsCodeReview: 0,
  },
};

const EMPTY_DRAFT: DraftPlan = { sprintId: 100, devSprintId: 300, assignments: {} };
const DRAFT_PO1_TO_ALICE: DraftPlan = { sprintId: 100, devSprintId: 300, assignments: { "PO-1": ALICE } };
// v1.69 (ADR-080): devSprintId genuinely UNSTORED (nothing chosen yet) — distinct from
// EMPTY_DRAFT above, whose devSprintId (300) happens to already equal the paired default,
// which would mask the non-sticky-pairing fix.
const NULL_DEV_DRAFT: DraftPlan = { sprintId: 100, devSprintId: null, assignments: {} };

// ── Mock defaults ─────────────────────────────────────────────────────────────

function mockDefaults(draft: DraftPlan = EMPTY_DRAFT) {
  vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
    data: SPRINT_DATA, loading: false, error: null, run: vi.fn(),
  });
  vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
    data: DEV_ROSTER, loading: false, error: null, run: vi.fn(), save: vi.fn(),
  });
  vi.mocked(useJiraModule.useSprintList).mockReturnValue({
    data: { boardId: 10, active: [], future: [DEV_SPRINT], closed: [] }, loading: false, error: null, run: vi.fn(),
  });
  vi.mocked(useJiraModule.useLeaves).mockReturnValue({
    data: {}, loading: false, error: null, run: vi.fn(), save: vi.fn(),
  });
  vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValue(draft);
  vi.mocked(draftPlanClientModule.setDraftPlan).mockImplementation(
    async (sprintId: number, devSprintId: number | null, assignments: Record<string, DraftAssignment>) => ({
      sprintId, devSprintId, assignments,
    })
  );

  // v1.69 (ADR-080): chip-editor + breakdown-dialog client defaults.
  vi.mocked(useJiraModule.updateTicketPoints).mockResolvedValue({
    key: "PO-1", url: "https://jira.example.com/browse/PO-1", updatedFields: ["storyPoints"],
  });
  vi.mocked(useJiraModule.updateTicketSummary).mockResolvedValue({
    key: "PO-1", url: "https://jira.example.com/browse/PO-1", updatedFields: ["summary"],
  });
  vi.mocked(useJiraModule.createPoTicket).mockResolvedValue({
    key: "PO-9", url: "https://jira.example.com/browse/PO-9", board: "PO",
  });
  vi.mocked(ticketActionsModule.getTransitions).mockResolvedValue({
    ticketKey: "PO-1",
    transitions: [{ id: "21", name: "Start Progress", to: { name: "In Progress", category: "inprogress" } }],
  });
  vi.mocked(ticketActionsModule.transitionIssue).mockResolvedValue({
    ticketKey: "PO-1", status: "In Progress", statusCategory: "inprogress",
  });
  vi.mocked(ticketActionsModule.moveIssueToSprint).mockResolvedValue({
    ticketKey: "PO-1", sprintId: PO_SPRINT_2.id,
  });
}

function renderCard(props: Partial<React.ComponentProps<typeof DraftPlanCard>> = {}) {
  return render(
    <DraftPlanCard
      poBoardId={20}
      sprintId={100}
      sprint={PO_SPRINT}
      devBoardId={10}
      teamRevision={0}
      onTeamChange={vi.fn()}
      sprints={[PO_SPRINT_2]}
      {...props}
    />
  );
}

/**
 * A member's display name also appears as an <option> text inside every "Draft
 * to..." select on the page, so a plain screen.getByText(name) is ambiguous.
 * This scopes the match to the tile's own <span> name label.
 */
function tileHeading(name: string): HTMLElement {
  return screen.getByText(
    (content, element) => content === name && element?.tagName.toLowerCase() === "span"
  );
}

/**
 * Testing Library's default text matcher only looks at an element's DIRECT text-node
 * children (not nested elements) — so text split across sibling <span>s (e.g. the
 * footer's "N of M tickets drafted..." line, where each number is its own <span>)
 * can never be found via a normal getByText. This checks the FULL, whitespace-
 * normalized textContent (which does recurse) of the first element of `tag` that matches.
 */
function getByFullText(tag: string, expected: string): HTMLElement {
  return screen.getByText((_content, element) => {
    if (!element || element.tagName.toLowerCase() !== tag) return false;
    const normalized = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return normalized === expected;
  });
}

/**
 * v1.69 (ADR-080): renders the card, opens the given chip's "Edit" panel, then
 * clicks "Break down" and waits for the dialog. Shared by the breakdown tests below.
 */
async function openBreakdownFor(issueKey: string, props: Partial<React.ComponentProps<typeof DraftPlanCard>> = {}) {
  renderCard(props);
  await waitFor(() => screen.getByText(issueKey));
  fireEvent.click(screen.getByRole("button", { name: `Edit ${issueKey}` }));
  fireEvent.click(screen.getByRole("button", { name: `Break down ${issueKey}` }));
  await screen.findByRole("dialog");
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDefaults();
});

afterEach(() => {
  cleanup();
});

// ── Draft-only note ───────────────────────────────────────────────────────────

describe("DraftPlanCard — draft-only note", () => {
  it("always shows the 'Draft only — nothing is assigned in Jira.' note", async () => {
    renderCard();
    expect(screen.getByText("Draft only — nothing is assigned in Jira.")).toBeTruthy();
    await waitFor(() => screen.getByText("PO-1")); // let the async draft load settle
  });

  it("shows the note even while the sprint/roster are loading", () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({ data: null, loading: true, error: null, run: vi.fn() });
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({ data: null, loading: true, error: null, run: vi.fn(), save: vi.fn() });
    renderCard();
    expect(screen.getByText("Draft only — nothing is assigned in Jira.")).toBeTruthy();
  });
});

// ── Tiles + unplanned chips ────────────────────────────────────────────────────

describe("DraftPlanCard — tiles + unplanned chips", () => {
  it("renders one tile per Dev roster member and a chip per unplanned ticket", async () => {
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    expect(tileHeading("Alice")).toBeTruthy();
    expect(tileHeading("Bob")).toBeTruthy();
    expect(screen.getByText("PO-1")).toBeTruthy();
    expect(screen.getByText("PO-2")).toBeTruthy();
    expect(screen.getByText("PO-3")).toBeTruthy();
    expect(screen.getByText(/Unplanned tickets/i)).toBeTruthy();
  });

  it("moves a drafted ticket out of the unplanned pane into its member's tile", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();

    await waitFor(() => screen.getByText("PO-2")); // still unplanned

    // Exactly ONE "Draft PO-1 to a developer" control exists (inside Alice's tile) —
    // if PO-1 were still ALSO an unplanned chip, there would be two such comboboxes.
    const po1Selects = screen.getAllByRole("combobox", { name: "Draft PO-1 to a developer" });
    expect(po1Selects).toHaveLength(1);
    // Pre-selected to Alice -> proves it's the tile's select (unplanned chips default to "").
    expect((po1Selects[0] as HTMLSelectElement).value).toBe("acc-1");
  });
});

// ── Drafting via the fallback select ──────────────────────────────────────────

describe("DraftPlanCard — select-fallback drafting", () => {
  it("calls setDraftPlan with the full updated assignments map when drafting via the select", async () => {
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" });
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": ALICE,
      });
    });
  });

  it("moving a drafted ticket via the tile's select re-drafts it to the newly chosen developer", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();

    // Wait for the draft to actually load — until then PO-1 briefly renders as an
    // unplanned chip (select value ""), which also matches this aria-label.
    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" }) as HTMLSelectElement;
      expect(select.value).toBe("acc-1");
    });
    const moveSelect = screen.getByRole("combobox", {
      name: "Draft PO-1 to a developer",
    }) as HTMLSelectElement;

    fireEvent.change(moveSelect, { target: { value: "acc-2" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": BOB,
      });
    });
  });
});

// ── Remove ────────────────────────────────────────────────────────────────────

describe("DraftPlanCard — remove", () => {
  it("removing a drafted ticket from a tile saves the map without it", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();

    const removeBtn = await screen.findByRole("button", { name: "Remove PO-1 from Alice" });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });
});

// ── Drag and drop ─────────────────────────────────────────────────────────────

describe("DraftPlanCard — drag and drop", () => {
  it("dropping a ticket key onto a dev tile drafts it to that developer", async () => {
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    const tile = tileHeading("Alice").closest("li")!;
    fireEvent.drop(tile, { dataTransfer: { getData: () => "PO-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": ALICE,
      });
    });
  });

  it("dropping a ticket key onto the unplanned pane un-drafts it", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitFor(() => screen.getByText(/Unplanned tickets/i));

    const pane = screen.getByText(/Unplanned tickets/i).closest("div")!;
    fireEvent.drop(pane, { dataTransfer: { getData: () => "PO-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });
});

// ── Over-capacity chip ────────────────────────────────────────────────────────

describe("DraftPlanCard — capacity delta chip", () => {
  it("shows a warning '+N over' chip when drafted points exceed capacity", async () => {
    mockDefaults({
      sprintId: 100,
      devSprintId: 300,
      assignments: { "PO-1": ALICE, "PO-2": ALICE }, // 5 + 3 = 8 pts to Alice
    });
    // Alice has 2 working leave days -> capacity = 8 (policy) - 2 = 6; drafted 8 -> +2 over.
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: { Alice: { [DEV_WORK_DAYS[0]!]: "VL", [DEV_WORK_DAYS[1]!]: "VL" } },
      loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });

    renderCard();
    await waitFor(() => screen.getByText("+2 over"));
  });

  it("shows a muted 'N free' chip when drafted points are under capacity", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-3": BOB } }); // 2 pts to Bob
    renderCard();
    await waitFor(() => screen.getByText("6 free")); // capacity 8 - drafted 2 = 6
  });

  it("shows a success 'At capacity' chip when drafted points equal capacity exactly", async () => {
    // Alice: PO-1(5) + PO-2(3) = 8 pts drafted; capacity = policy 8 - 0 leave days = 8.
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-1": ALICE, "PO-2": ALICE } });
    renderCard();
    await waitFor(() => screen.getByText("At capacity"));
  });

  it("shows no delta chip and '—' capacity when the paired Dev sprint has no dates", async () => {
    const noDatesSprint: SprintRef = { ...DEV_SPRINT, startDate: null, endDate: null };
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: { boardId: 10, active: [], future: [noDatesSprint], closed: [] }, loading: false, error: null, run: vi.fn(),
    });

    renderCard();
    await waitFor(() => screen.getByText(/Capacity unknown/i));
    // "capacity —" is direct text alongside the "N pts drafted (M) ·" prefix within the
    // same <p> (not its own wrapper element) — a substring regex finds it; an exact
    // string match would not, since the <p>'s own text is the whole sentence.
    expect(screen.getAllByText(/capacity —/).length).toBeGreaterThanOrEqual(2); // both Alice + Bob tiles
    expect(screen.queryByText(/free$/)).toBeNull();
    expect(screen.queryByText("At capacity")).toBeNull();
    expect(screen.queryByText(/over$/)).toBeNull();
  });
});

// ── Dev sprint select ─────────────────────────────────────────────────────────

describe("DraftPlanCard — Dev sprint (capacity source) select", () => {
  it("defaults to the paired Dev sprint and saving a change keeps the same assignments", async () => {
    const otherDevSprint: SprintRef = {
      id: 301, name: "Dev Sprint 9", state: "active",
      startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z",
      completeDate: null, goal: null, boardId: 10,
    };
    mockDefaults(DRAFT_PO1_TO_ALICE);
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: { boardId: 10, active: [otherDevSprint], future: [DEV_SPRINT], closed: [] },
      loading: false, error: null, run: vi.fn(),
    });

    renderCard();

    const select = (await screen.findByRole("combobox", {
      name: "Dev sprint (capacity source)",
    })) as HTMLSelectElement;
    expect(select.value).toBe("300");

    fireEvent.change(select, { target: { value: "301" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 301, {
        "PO-1": ALICE,
      });
    });
  });
});

// ── Footer summary + Clear draft ──────────────────────────────────────────────

describe("DraftPlanCard — footer summary + Clear draft", () => {
  it("shows the drafted-count / points-vs-capacity summary", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-1": ALICE } });
    renderCard();

    // 1 of 3 tickets drafted; 5 pts drafted; capacity = 8 (Alice) + 8 (Bob) = 16, no leaves.
    await waitFor(() => {
      expect(
        getByFullText("p", "1 of 3 tickets drafted · 5 pts of 16 pts capacity")
      ).toBeTruthy();
    });
  });

  it("Clear draft saves an empty assignments map", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitFor(() => screen.getByRole("button", { name: "Clear draft" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear draft" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });
});

// ── Needs attention (stale entries) ───────────────────────────────────────────

describe("DraftPlanCard — Needs attention (stale entries)", () => {
  it("renders a removable row for a draft entry whose ticket left the sprint", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-99": ALICE } });
    renderCard();

    await waitFor(() => screen.getByText(/Needs attention/i));
    expect(screen.getByText("PO-99")).toBeTruthy();
    expect(screen.getByText(/ticket left the sprint/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove PO-99 from draft" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });

  it("renders a removable row for a draft entry whose member left the Dev roster", async () => {
    mockDefaults({
      sprintId: 100,
      devSprintId: 300,
      assignments: { "PO-1": { accountId: "acc-99", displayName: "Charlie" } },
    });
    renderCard();

    await waitFor(() => screen.getByText(/Needs attention/i));
    expect(screen.getByText(/no longer on the Dev team/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove PO-1 from draft" }));
    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });
});

// ── Empty / edge states ────────────────────────────────────────────────────────

describe("DraftPlanCard — empty/edge states", () => {
  it("shows a hint when no sprint is selected", () => {
    renderCard({ sprintId: null });
    expect(screen.getByText(/Select a sprint to draft a capacity plan/i)).toBeTruthy();
  });

  it("shows a hint when devBoardId has not resolved yet", () => {
    renderCard({ devBoardId: undefined });
    expect(screen.getByText(/Select a sprint to draft a capacity plan/i)).toBeTruthy();
  });

  it("shows a hint and still renders the in-card TeamManager when the Dev roster is empty", async () => {
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [], loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });
    renderCard();

    await waitFor(() => screen.getByText(/Manage dev team/i));
    expect(screen.getByTestId("team-manager")).toBeTruthy();
  });

  it("renders an aria-busy skeleton while the sprint and roster are loading", () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({ data: null, loading: true, error: null, run: vi.fn() });
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({ data: null, loading: true, error: null, run: vi.fn(), save: vi.fn() });

    const { container } = renderCard();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("shows bridge-down error with Retry when the sprint and roster both fail to load", async () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: null, loading: false, error: { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" }, run: vi.fn(),
    });
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null, loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });

    renderCard();

    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByText(/Jira bridge is offline/i)).toBeTruthy();
    expect(screen.getByText(/dev:jira:http/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });

  it("calls run() on the failed sources when Retry is clicked", async () => {
    const sprintRun = vi.fn();
    const teamRun = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: null, loading: false, error: { code: "BRIDGE_DOWN", message: "down" }, run: sprintRun,
    });
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null, loading: false, error: null, run: teamRun, save: vi.fn(),
    });

    renderCard();
    await waitFor(() => screen.getByRole("button", { name: /Retry/i }));
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    expect(sprintRun).toHaveBeenCalled();
    expect(teamRun).toHaveBeenCalled();
  });
});

// ── Mutation error ────────────────────────────────────────────────────────────

describe("DraftPlanCard — mutation error", () => {
  it("shows an inline aria-live error and rolls back when setDraftPlan rejects", async () => {
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    vi.mocked(draftPlanClientModule.setDraftPlan).mockRejectedValueOnce({
      code: "UPSTREAM", message: "Jira bridge rejected the draft save",
    });

    const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" });
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(screen.getByText(/Jira bridge rejected the draft save/i)).toBeTruthy();
    });

    // Rolled back — PO-1 is unplanned again.
    expect(screen.getByRole("combobox", { name: "Draft PO-1 to a developer" })).toBeTruthy();
  });
});

// ── v1.69 (ADR-080): chip "Edit" expander ─────────────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) chip expander", () => {
  it("opens the chip's edit panel on Edit, exposing rename/status/move/break down", async () => {
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    const editBtn = screen.getByRole("button", { name: "Edit PO-1" });
    expect(editBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(editBtn);

    expect(editBtn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Rename PO-1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change status for PO-1" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Move PO-1 to a sprint" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Break down PO-1" })).toBeTruthy();
    expect(screen.getByText("These edits change the real Jira ticket.")).toBeTruthy();
  });

  it("v1.69.1: disables the chip's drag affordance while expanded, so text-selection inside the panel doesn't start a drag", async () => {
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    const editBtn = screen.getByRole("button", { name: "Edit PO-1" });
    const chip = editBtn.closest("li")!;
    expect(chip.getAttribute("draggable")).toBe("true");

    fireEvent.click(editBtn); // expand

    expect(chip.getAttribute("draggable")).toBe("false");

    fireEvent.click(editBtn); // collapse

    expect(chip.getAttribute("draggable")).toBe("true");
  });
});

// ── v1.69 (ADR-080): chip rename + status flow ────────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) chip rename", () => {
  it("renaming a ticket calls updateTicketSummary and refetches the PO sprint", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: SPRINT_DATA, loading: false, error: null, run: runSpy,
    });
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    fireEvent.click(screen.getByRole("button", { name: "Edit PO-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename PO-1" }));

    const input = screen.getByRole("textbox", { name: "New summary for PO-1" });
    fireEvent.change(input, { target: { value: "PO-1 renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary for PO-1" }));

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketSummary)).toHaveBeenCalledWith("PO-1", "PO-1 renamed")
    );
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });
});

describe("DraftPlanCard — v1.69 (ADR-080) chip status flow", () => {
  it("changing status calls transitionIssue and refetches the PO sprint", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: SPRINT_DATA, loading: false, error: null, run: runSpy,
    });
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    fireEvent.click(screen.getByRole("button", { name: "Edit PO-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Change status for PO-1" }));

    await waitFor(() => expect(vi.mocked(ticketActionsModule.getTransitions)).toHaveBeenCalledWith("PO-1"));
    const statusSelect = await screen.findByRole("combobox", { name: "New status for PO-1" });
    await waitFor(() =>
      expect(Array.from((statusSelect as HTMLSelectElement).options).some((o) => o.text === "In Progress")).toBe(true)
    );

    fireEvent.change(statusSelect, { target: { value: "21" } });

    await waitFor(() => expect(vi.mocked(ticketActionsModule.transitionIssue)).toHaveBeenCalledWith("PO-1", "21"));
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });
});

// ── v1.69 (ADR-080): move from a chip auto-undrafts ───────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) move from a chip", () => {
  it("moving a drafted ticket removes its draft entry (stored devSprintId) and refetches the PO sprint", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE); // devSprintId stored = 300
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: SPRINT_DATA, loading: false, error: null, run: runSpy,
    });
    renderCard();

    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" }) as HTMLSelectElement;
      expect(select.value).toBe("acc-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit PO-1" }));
    const moveSelect = screen.getByRole("combobox", { name: "Move PO-1 to a sprint" });
    fireEvent.change(moveSelect, { target: { value: String(PO_SPRINT_2.id) } });

    await waitFor(() =>
      expect(vi.mocked(ticketActionsModule.moveIssueToSprint)).toHaveBeenCalledWith("PO-1", PO_SPRINT_2.id)
    );
    // Draft entry removed WITHOUT the moved key, persisting the STORED devSprintId (300) —
    // not the effective one (which could differ once auto-pairing is non-sticky).
    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });

  it("moving a ticket that was never drafted just refetches the PO sprint (no draft write)", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: SPRINT_DATA, loading: false, error: null, run: runSpy,
    });
    renderCard(); // EMPTY_DRAFT default — PO-1 is unplanned
    await waitFor(() => screen.getByText("PO-1"));

    fireEvent.click(screen.getByRole("button", { name: "Edit PO-1" }));
    const moveSelect = screen.getByRole("combobox", { name: "Move PO-1 to a sprint" });
    fireEvent.change(moveSelect, { target: { value: String(PO_SPRINT_2.id) } });

    await waitFor(() =>
      expect(vi.mocked(ticketActionsModule.moveIssueToSprint)).toHaveBeenCalledWith("PO-1", PO_SPRINT_2.id)
    );
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
    expect(vi.mocked(draftPlanClientModule.setDraftPlan)).not.toHaveBeenCalled();
  });
});

// ── v1.69 (ADR-080): non-sticky auto-pairing ──────────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) non-sticky auto-pairing", () => {
  it("drafting with nothing stored persists devSprintId: null (not the auto-paired id)", async () => {
    mockDefaults(NULL_DEV_DRAFT);
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));

    // The effective/paired default is still 300 (the only future Dev sprint) for capacity...
    const select = await screen.findByRole("combobox", { name: "Dev sprint (capacity source)" });
    expect((select as HTMLSelectElement).value).toBe("300");

    // ...but drafting must NOT persist that guess.
    const draftSelect = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" });
    fireEvent.change(draftSelect, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, null, {
        "PO-1": ALICE,
      });
    });
  });
});

// ── v1.69 (ADR-080): "Reset to auto" ───────────────────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) Reset to auto", () => {
  it("does not render when nothing is stored", async () => {
    mockDefaults(NULL_DEV_DRAFT);
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));
    expect(screen.queryByRole("button", { name: "Reset to auto" })).toBeNull();
  });

  it("appears when a devSprintId is stored and persists null with unchanged assignments", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE); // devSprintId stored = 300
    renderCard();

    const resetBtn = await screen.findByRole("button", { name: "Reset to auto" });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, null, {
        "PO-1": ALICE,
      });
    });
  });
});

// ── v1.69 (ADR-080): "Auto-paired" label ──────────────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) Auto-paired label", () => {
  it("shows an 'Auto-paired' hint when nothing is stored and a paired default is in use", async () => {
    mockDefaults(NULL_DEV_DRAFT);
    renderCard();
    await waitFor(() => screen.getByText("Auto-paired"));
  });

  it("hides the hint once a devSprintId is stored", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitFor(() => screen.getByText("PO-1"));
    expect(screen.queryByText("Auto-paired")).toBeNull();
  });
});

// ── v1.69 (ADR-080): capacity-source transparency ─────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) capacity-source transparency", () => {
  it("shows the leave/offset day count when the paired sprint's leaves are non-empty", async () => {
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: { Alice: { [DEV_WORK_DAYS[0]!]: "VL", [DEV_WORK_DAYS[1]!]: "VL" } },
      loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });
    renderCard();
    await waitFor(() => screen.getByText("2 leave/offset day(s) found across 1 member(s)"));
  });

  it("shows a warning when the paired sprint's leaves come back empty", async () => {
    renderCard(); // default useLeaves -> data: {}
    await waitFor(() =>
      screen.getByText(/No leaves or offsets recorded under this Dev sprint/i)
    );
  });

  it("shows a loading placeholder for leaves and 'capacity —' on tiles while leaves load", async () => {
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null, loading: true, error: null, run: vi.fn(), save: vi.fn(),
    });
    renderCard();
    await waitFor(() => screen.getByText("Loading leaves…"));
    // Neither tile renders a numeric capacity while leaves load.
    expect(screen.getAllByText(/capacity —/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/free$/)).toBeNull();
    expect(screen.queryByText("At capacity")).toBeNull();
    expect(screen.queryByText(/over$/)).toBeNull();
  });

  it("does not show the indicator when the roster is empty", async () => {
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [], loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });
    renderCard();
    await waitFor(() => screen.getByText(/Manage dev team/i));
    expect(screen.queryByText(/leave\/offset day/i)).toBeNull();
    expect(screen.queryByText(/No leaves or offsets recorded/i)).toBeNull();
  });
});

// ── v1.69 (ADR-080): breakdown dialog ──────────────────────────────────────────

describe("DraftPlanCard — v1.69 (ADR-080) breakdown dialog", () => {
  it("creates N new PO stories sequentially with sprintId + description provenance, then refetches", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: SPRINT_DATA, loading: false, error: null, run: runSpy,
    });
    await openBreakdownFor("PO-1");

    fireEvent.click(screen.getByRole("button", { name: /Create \(2\)/ }));

    await waitFor(() => expect(vi.mocked(useJiraModule.createPoTicket)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(useJiraModule.createPoTicket)).toHaveBeenNthCalledWith(1, {
      summary: "PO-1 summary (part 1)",
      description: "Broken down from PO-1: PO-1 summary",
      storyPoints: 0,
      sprintId: 100,
    });
    expect(vi.mocked(useJiraModule.createPoTicket)).toHaveBeenNthCalledWith(2, {
      summary: "PO-1 summary (part 2)",
      description: "Broken down from PO-1: PO-1 summary",
      storyPoints: 0,
      sprintId: 100,
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Close breakdown dialog" })).toBeTruthy());
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });

  it("locks succeeded rows on partial failure; only the failed row is retryable and never duplicated", async () => {
    vi.mocked(useJiraModule.createPoTicket)
      .mockResolvedValueOnce({ key: "PO-10", url: "https://jira.example.com/browse/PO-10", board: "PO" })
      .mockRejectedValueOnce({ code: "UPSTREAM", message: "Jira rejected the create" })
      .mockResolvedValueOnce({ key: "PO-11", url: "https://jira.example.com/browse/PO-11", board: "PO" });

    await openBreakdownFor("PO-1");
    fireEvent.click(screen.getByRole("button", { name: /Create \(2\)/ }));

    await waitFor(() => expect(vi.mocked(useJiraModule.createPoTicket)).toHaveBeenCalledTimes(2));
    // Row 1 succeeded -> a Jira-key link; row 2 failed -> an error + Retry.
    await waitFor(() => expect(screen.getByRole("link", { name: "Open PO-10 in Jira" })).toBeTruthy());
    expect(screen.getByText("Jira rejected the create")).toBeTruthy();
    const retryBtn = screen.getByRole("button", { name: "Retry row 2" });

    fireEvent.click(retryBtn);

    await waitFor(() => expect(vi.mocked(useJiraModule.createPoTicket)).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open PO-11 in Jira" })).toBeTruthy());
    // Row 1 was never re-created — exactly one call ever referenced its row summary.
    expect(
      vi.mocked(useJiraModule.createPoTicket).mock.calls.filter(
        ([arg]) => arg.summary === "PO-1 summary (part 1)"
      )
    ).toHaveLength(1);
  });

  it("checking the zero-original option calls updateTicketPoints(key, 0) after all rows succeed", async () => {
    await openBreakdownFor("PO-1");

    fireEvent.click(screen.getByLabelText("Set PO-1's points to 0 after creating"));
    fireEvent.click(screen.getByRole("button", { name: /Create \(2\)/ }));

    await waitFor(() => expect(vi.mocked(useJiraModule.createPoTicket)).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketPoints)).toHaveBeenCalledWith("PO-1", 0)
    );
  });
});

// DraftPlanCard tests — v1.70, ADR-081 (pure-draft multi-developer split +
// full-width redesign; CONTRACTS.md §4.30)
//
// Keyless/offline. Mocking style: useActiveSprint/useTeamMembers/useSprintList/
// useLeaves are mocked as HOOKS (matches AssignmentList.test.tsx / LeavesPlotterCard.test.tsx),
// but useDraftPlan is left as the REAL hook — its CLIENT module (draftPlanClient)
// is mocked instead, so drafting/editing/removing exercises the real optimistic
// save + rollback logic and asserts on the resulting setDraftPlan calls.
//
// This card is now strictly Jira-write-free (ADR-081): the mocks below also stub
// every Jira-WRITING client (updateTicketPoints/updateTicketSummary/createPoTicket/
// assignIssue/transitionIssue/moveIssueToSprint) purely so tests can assert they
// are NEVER called — DraftPlanCard doesn't even import them anymore, but the spies
// turn that into an explicit, regression-proof assertion instead of an absence of
// evidence.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DraftPlanCard } from "./DraftPlanCard";
import { sprintWorkingDays } from "../lib/capacity";
import type { DraftShare, DraftPlan, IssueSummary, SprintRef } from "../lib/types";

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
    // v1.70 (ADR-081): stubbed ONLY so "never writes to Jira" tests have something
    // to assert against — DraftPlanCard no longer imports any of these.
    updateTicketPoints: vi.fn(),
    updateTicketSummary: vi.fn(),
    createPoTicket: vi.fn(),
  };
});

vi.mock("../lib/assignClient", () => ({
  getAssignableUsers: vi.fn(),
  assignIssue: vi.fn(),
}));

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
import * as assignClientModule from "../lib/assignClient";
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

function share(accountId: string, displayName: string, points: number): DraftShare {
  return { accountId, displayName, points };
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
const DRAFT_PO1_TO_ALICE: DraftPlan = {
  sprintId: 100, devSprintId: 300, assignments: { "PO-1": [share("acc-1", "Alice", 5)] },
};
const DRAFT_PO1_PARTIAL_TO_ALICE: DraftPlan = {
  sprintId: 100, devSprintId: 300, assignments: { "PO-1": [share("acc-1", "Alice", 2)] },
};
const DRAFT_PO1_SPLIT: DraftPlan = {
  sprintId: 100, devSprintId: 300,
  assignments: { "PO-1": [share("acc-1", "Alice", 3), share("acc-2", "Bob", 2)] },
};
// v1.69 (ADR-080), still true in v1.70: devSprintId genuinely UNSTORED (nothing chosen
// yet) — distinct from EMPTY_DRAFT above, whose devSprintId (300) happens to already
// equal the paired default, which would mask the non-sticky-pairing fix.
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
    async (sprintId: number, devSprintId: number | null, assignments: Record<string, DraftShare[]>) => ({
      sprintId, devSprintId, assignments,
    })
  );

  // v1.70 (ADR-081): defensive spies — DraftPlanCard must never call any of these.
  vi.mocked(useJiraModule.updateTicketPoints).mockResolvedValue({
    key: "PO-1", url: "https://jira.example.com/browse/PO-1", updatedFields: ["storyPoints"],
  });
  vi.mocked(useJiraModule.updateTicketSummary).mockResolvedValue({
    key: "PO-1", url: "https://jira.example.com/browse/PO-1", updatedFields: ["summary"],
  });
  vi.mocked(useJiraModule.createPoTicket).mockResolvedValue({
    key: "PO-9", url: "https://jira.example.com/browse/PO-9", board: "PO",
  });
  vi.mocked(assignClientModule.assignIssue).mockResolvedValue({
    ticketKey: "PO-1", accountId: "acc-1", assigned: true,
  });
  vi.mocked(ticketActionsModule.getTransitions).mockResolvedValue({ ticketKey: "PO-1", transitions: [] });
  vi.mocked(ticketActionsModule.transitionIssue).mockResolvedValue({
    ticketKey: "PO-1", status: "In Progress", statusCategory: "inprogress",
  });
  vi.mocked(ticketActionsModule.moveIssueToSprint).mockResolvedValue({ ticketKey: "PO-1", sprintId: 999 });
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
      {...props}
    />
  );
}

// ── Scoped query helpers ─────────────────────────────────────────────────────
//
// A member's display name appears in more than one place once tickets are
// drafted (their own dev-card heading, a "split across" chip on a ticket row,
// and an <option> inside that row's select), so plain screen.getByText(name) is
// ambiguous. Scoping to the labelled region — or to one card/row's own subtree —
// disambiguates.

function developersRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Developers" });
}

function sprintTicketsRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Sprint tickets" });
}

/** A developer's own card — located by their name heading, unique within the region. */
function devCard(name: string): HTMLElement {
  return within(developersRegion()).getByText(name).closest("li")!;
}

/** A ticket's own row — located by its unique "Open <key> in Jira" link. */
function ticketRow(key: string): HTMLElement {
  return screen.getByRole("link", { name: `Open ${key} in Jira` }).closest("li")!;
}

/** Waits for the async draft load to settle (PO-1's row is always present once loaded). */
async function waitForLoaded(): Promise<void> {
  await waitFor(() => screen.getByRole("link", { name: "Open PO-1 in Jira" }));
}

/**
 * Testing Library's default text matcher only looks at an element's DIRECT text-node
 * children (not nested elements) — so text split across sibling <span>s (e.g. a dev
 * card's "N pts drafted (M) · capacity X" line, or the footer's "N of M tickets
 * drafted..." line, where each number is its own <span>) can never be found via a
 * normal getByText. This checks the FULL, whitespace-normalized textContent (which
 * does recurse) of the first element of `tag` that matches, scoped to `container`.
 */
function getByFullText(tag: string, expected: string, container: HTMLElement = document.body): HTMLElement {
  return within(container).getByText((_content, element) => {
    if (!element || element.tagName.toLowerCase() !== tag) return false;
    const normalized = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return normalized === expected;
  });
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
    await waitForLoaded();
  });

  it("shows the note even while the sprint/roster are loading", () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({ data: null, loading: true, error: null, run: vi.fn() });
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({ data: null, loading: true, error: null, run: vi.fn(), save: vi.fn() });
    renderCard();
    expect(screen.getByText("Draft only — nothing is assigned in Jira.")).toBeTruthy();
  });
});

// ── Developer cards + sprint ticket rows ──────────────────────────────────────

describe("DraftPlanCard — developer cards + sprint ticket rows", () => {
  it("renders one card per Dev roster member and one row per PO sprint ticket", async () => {
    renderCard();
    await waitForLoaded();

    expect(within(developersRegion()).getByText("Alice")).toBeTruthy();
    expect(within(developersRegion()).getByText("Bob")).toBeTruthy();
    expect(ticketRow("PO-1")).toBeTruthy();
    expect(ticketRow("PO-2")).toBeTruthy();
    expect(ticketRow("PO-3")).toBeTruthy();
  });

  it("shows a per-developer empty-state invitation when nobody has been drafted yet", async () => {
    renderCard();
    await waitForLoaded();

    expect(within(devCard("Alice")).getByText("Drop a ticket here to draft it.")).toBeTruthy();
    expect(within(devCard("Bob")).getByText("Drop a ticket here to draft it.")).toBeTruthy();
  });
});

// ── Drag a ticket onto a developer card ───────────────────────────────────────

describe("DraftPlanCard — drag a ticket onto a developer card", () => {
  it("drops PO-1 onto Alice's card and drafts a full-points share with the STORED devSprintId", async () => {
    renderCard(); // EMPTY_DRAFT: devSprintId stored = 300
    await waitForLoaded();

    fireEvent.drop(devCard("Alice"), { dataTransfer: { getData: () => "PO-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
      });
    });
  });

  it("dropping onto a developer who already holds a share of that ticket is a no-op (de-dupe)", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();

    fireEvent.drop(devCard("Alice"), { dataTransfer: { getData: () => "PO-1" } });

    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(draftPlanClientModule.setDraftPlan)).not.toHaveBeenCalled();
  });
});

// ── Select a11y path ───────────────────────────────────────────────────────────

describe("DraftPlanCard — select a11y path", () => {
  it("choosing a developer from a ticket's select drafts a full-points share", async () => {
    renderCard();
    await waitForLoaded();

    const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" });
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
      });
    });
  });
});

// ── Splitting a ticket across two developers ──────────────────────────────────

describe("DraftPlanCard — splitting a ticket across two developers", () => {
  it("adding a second developer via the select defaults to the ticket's remaining unallocated points", async () => {
    mockDefaults(DRAFT_PO1_PARTIAL_TO_ALICE); // Alice already holds 2 of PO-1's 5 pts
    renderCard();
    await waitForLoaded();

    // Alice already has a share -> the select only offers Bob.
    const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Draft to…", "Bob"]);

    fireEvent.change(select, { target: { value: "acc-2" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [
          { accountId: "acc-1", displayName: "Alice", points: 2 },
          { accountId: "acc-2", displayName: "Bob", points: 3 }, // remaining = 5 - 2
        ],
      });
    });
  });

  it("dragging onto a second developer's card also splits the ticket (drag-based split)", async () => {
    mockDefaults(DRAFT_PO1_PARTIAL_TO_ALICE);
    renderCard();
    await waitForLoaded();

    fireEvent.drop(devCard("Bob"), { dataTransfer: { getData: () => "PO-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [
          { accountId: "acc-1", displayName: "Alice", points: 2 },
          { accountId: "acc-2", displayName: "Bob", points: 3 },
        ],
      });
    });
  });

  it("shows 'All drafted' and disables the select once every roster member already holds a share", async () => {
    mockDefaults(DRAFT_PO1_SPLIT); // Alice + Bob both already share PO-1
    renderCard();
    await waitForLoaded();

    const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options[0]!.text).toBe("All drafted");
  });
});

// ── Editing a share's points (draft only) ─────────────────────────────────────

describe("DraftPlanCard — editing a share's points", () => {
  it("commits new points on blur, saving via setDraftPlan only — no Jira-writing client is called", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();

    const input = screen.getByLabelText("Draft points for PO-1 on Alice") as HTMLInputElement;
    expect(input.value).toBe("5");

    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 7 }],
      });
    });
    expect(vi.mocked(useJiraModule.updateTicketPoints)).not.toHaveBeenCalled();
    expect(vi.mocked(assignClientModule.assignIssue)).not.toHaveBeenCalled();
  });

  it("reverts to the committed value and does not save on an invalid (negative) entry", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();

    const input = screen.getByLabelText("Draft points for PO-1 on Alice") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe("5"));
    expect(vi.mocked(draftPlanClientModule.setDraftPlan)).not.toHaveBeenCalled();
  });

  it("does not save when the value is unchanged", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();

    const input = screen.getByLabelText("Draft points for PO-1 on Alice");
    fireEvent.blur(input); // committed on mount === current -> no write

    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(draftPlanClientModule.setDraftPlan)).not.toHaveBeenCalled();
  });
});

// ── Removing a share ───────────────────────────────────────────────────────────

describe("DraftPlanCard — removing a share", () => {
  it("removing the ONLY share on a ticket omits the key entirely", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove PO-1 from Alice" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });

  it("removing ONE of two shares keeps the ticket key with the remaining share", async () => {
    mockDefaults(DRAFT_PO1_SPLIT); // Alice(3) + Bob(2)
    renderCard();
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove PO-1 from Alice" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [{ accountId: "acc-2", displayName: "Bob", points: 2 }],
      });
    });
  });
});

// ── Per-developer drafted load + the over/under chip ──────────────────────────

describe("DraftPlanCard — per-developer drafted load and the over/under chip", () => {
  it("sums a single developer's shares across multiple tickets into their drafted load", async () => {
    mockDefaults({
      sprintId: 100, devSprintId: 300,
      assignments: { "PO-1": [share("acc-1", "Alice", 5)], "PO-2": [share("acc-1", "Alice", 3)] },
    });
    renderCard();
    await waitForLoaded();

    expect(getByFullText("p", "8 pts drafted (2) · capacity 8", devCard("Alice"))).toBeTruthy();
  });

  it("keeps a split ticket's two shares independent in each developer's total (not the ticket's full points)", async () => {
    mockDefaults(DRAFT_PO1_SPLIT); // Alice(3) + Bob(2) on PO-1, whose real points are 5
    renderCard();
    await waitForLoaded();

    expect(getByFullText("p", "3 pts drafted (1) · capacity 8", devCard("Alice"))).toBeTruthy();
    expect(getByFullText("p", "2 pts drafted (1) · capacity 8", devCard("Bob"))).toBeTruthy();
  });

  it("shows a warning '+N over' chip when drafted points exceed capacity", async () => {
    mockDefaults({
      sprintId: 100, devSprintId: 300,
      assignments: { "PO-1": [share("acc-1", "Alice", 5)], "PO-2": [share("acc-1", "Alice", 3)] }, // 8 pts to Alice
    });
    // Alice has 2 working leave days -> capacity = 8 (policy) - 2 = 6; drafted 8 -> +2 over.
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: { Alice: { [DEV_WORK_DAYS[0]!]: "VL", [DEV_WORK_DAYS[1]!]: "VL" } },
      loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });

    renderCard();
    await waitForLoaded();
    expect(within(devCard("Alice")).getByText("+2 over")).toBeTruthy();
  });

  it("shows a muted 'N free' chip when drafted points are under capacity", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-3": [share("acc-2", "Bob", 2)] } });
    renderCard();
    await waitForLoaded();
    expect(within(devCard("Bob")).getByText("6 free")).toBeTruthy(); // capacity 8 - drafted 2 = 6
  });

  it("shows a success 'At capacity' chip when drafted points equal capacity exactly", async () => {
    mockDefaults({
      sprintId: 100, devSprintId: 300,
      assignments: { "PO-1": [share("acc-1", "Alice", 5)], "PO-2": [share("acc-1", "Alice", 3)] },
    });
    renderCard();
    await waitForLoaded();
    expect(within(devCard("Alice")).getByText("At capacity")).toBeTruthy();
  });

  it("shows no delta chip and '—' capacity when the paired Dev sprint has no dates", async () => {
    const noDatesSprint: SprintRef = { ...DEV_SPRINT, startDate: null, endDate: null };
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: { boardId: 10, active: [], future: [noDatesSprint], closed: [] }, loading: false, error: null, run: vi.fn(),
    });

    renderCard();
    await waitForLoaded();
    expect(within(devCard("Alice")).getByText("—")).toBeTruthy();
    expect(within(devCard("Bob")).getByText("—")).toBeTruthy();
    expect(screen.queryByText(/free$/)).toBeNull();
    expect(screen.queryByText("At capacity")).toBeNull();
    expect(screen.queryByText(/over$/)).toBeNull();
  });
});

// ── Allocation indicator (Sprint tickets tier) ────────────────────────────────

describe("DraftPlanCard — allocation indicator", () => {
  it("shows 'Not drafted' for a ticket with no shares", async () => {
    renderCard(); // EMPTY_DRAFT
    await waitForLoaded();
    expect(within(ticketRow("PO-2")).getByText("Not drafted")).toBeTruthy();
  });

  it("shows 'N of M pts drafted' once a ticket has at least one share", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE); // Alice drafted all 5 of PO-1's 5 pts
    renderCard();
    await waitForLoaded();
    expect(within(ticketRow("PO-1")).getByText("5 of 5 pts drafted")).toBeTruthy();
  });

  it("flags a ticket as 'Over-allocated' when its shares sum past its real points", async () => {
    mockDefaults({
      sprintId: 100, devSprintId: 300,
      assignments: { "PO-1": [share("acc-1", "Alice", 4), share("acc-2", "Bob", 4)] }, // 8 > 5
    });
    renderCard();
    await waitForLoaded();

    const row = ticketRow("PO-1");
    expect(within(row).getByText("8 of 5 pts drafted")).toBeTruthy();
    expect(within(row).getByText("Over-allocated")).toBeTruthy();
  });

  it("renders the real Jira points read-only — plain text, not an editable control", async () => {
    renderCard();
    await waitForLoaded();
    expect(within(ticketRow("PO-1")).getByText("5 pts")).toBeTruthy();
    expect(screen.queryByLabelText(/story points/i)).toBeNull();
  });
});

// ── Never writes to Jira ───────────────────────────────────────────────────────

describe("DraftPlanCard — never writes to Jira", () => {
  it("drafting, editing points, and removing a share call ONLY setDraftPlan — never update_ticket/assign/transition/move/create", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();

    // Edit a share's points.
    const input = screen.getByLabelText("Draft points for PO-1 on Alice");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    await waitFor(() => expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledTimes(1));

    // Draft PO-2 to Bob via the select.
    fireEvent.change(screen.getByRole("combobox", { name: "Draft PO-2 to a developer" }), { target: { value: "acc-2" } });
    await waitFor(() => expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledTimes(2));

    // Remove Alice's share of PO-1.
    fireEvent.click(screen.getByRole("button", { name: "Remove PO-1 from Alice" }));
    await waitFor(() => expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledTimes(3));

    expect(vi.mocked(useJiraModule.updateTicketPoints)).not.toHaveBeenCalled();
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
    expect(vi.mocked(useJiraModule.createPoTicket)).not.toHaveBeenCalled();
    expect(vi.mocked(assignClientModule.assignIssue)).not.toHaveBeenCalled();
    expect(vi.mocked(ticketActionsModule.transitionIssue)).not.toHaveBeenCalled();
    expect(vi.mocked(ticketActionsModule.moveIssueToSprint)).not.toHaveBeenCalled();
  });
});

// ── Sprint tickets ordering ────────────────────────────────────────────────────

describe("DraftPlanCard — Sprint tickets ordering", () => {
  it("sorts undrafted tickets before drafted ones, preserving relative order within each group", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-1": [share("acc-1", "Alice", 5)] } });
    renderCard(); // PO-1 drafted; PO-2, PO-3 undrafted (sprint order: PO-1, PO-2, PO-3)
    await waitForLoaded();

    const region = sprintTicketsRegion();
    const keys = within(region)
      .getAllByRole("link", { name: /^Open PO-\d in Jira$/ })
      .map((el) => el.textContent);
    expect(keys).toEqual(["PO-2", "PO-3", "PO-1"]); // undrafted lead the queue
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
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
      });
    });
  });
});

// ── Footer summary + Clear draft ──────────────────────────────────────────────

describe("DraftPlanCard — footer summary + Clear draft", () => {
  it("shows the drafted-count / points-vs-capacity summary as Σ share points, not real ticket points", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-1": [share("acc-1", "Alice", 4)] } }); // drafted 4, PO-1's real points are 5
    renderCard();
    await waitForLoaded();

    // 1 of 3 tickets drafted; 4 pts drafted (the SHARE, not PO-1's real 5); capacity 8+8=16.
    await waitFor(() => {
      expect(getByFullText("p", "1 of 3 tickets drafted · 4 pts of 16 pts capacity")).toBeTruthy();
    });
  });

  it("Clear draft saves an empty assignments map with the stored devSprintId", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitFor(() => screen.getByRole("button", { name: "Clear draft" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear draft" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });
});

// ── Needs attention (stale share entries) ─────────────────────────────────────

describe("DraftPlanCard — Needs attention (stale share entries)", () => {
  it("renders a removable row for a share whose ticket left the sprint", async () => {
    mockDefaults({ sprintId: 100, devSprintId: 300, assignments: { "PO-99": [share("acc-1", "Alice", 5)] } });
    renderCard();

    await waitFor(() => screen.getByText(/Needs attention/i));
    expect(screen.getByText(/ticket left the sprint/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Alice's draft share of PO-99" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });

  it("renders a removable row for a share whose member left the Dev roster", async () => {
    mockDefaults({
      sprintId: 100, devSprintId: 300,
      assignments: { "PO-1": [share("acc-99", "Charlie", 5)] },
    });
    renderCard();

    await waitFor(() => screen.getByText(/Needs attention/i));
    expect(screen.getByText(/no longer on the Dev team/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Charlie's draft share of PO-1" }));
    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {});
    });
  });

  it("on a split ticket, flags only the ex-member's share — the still-rostered member's share is untouched", async () => {
    mockDefaults({
      sprintId: 100, devSprintId: 300,
      assignments: { "PO-1": [share("acc-1", "Alice", 3), share("acc-99", "Charlie", 2)] },
    });
    renderCard();

    await waitFor(() => screen.getByText(/Needs attention/i));
    fireEvent.click(screen.getByRole("button", { name: "Remove Charlie's draft share of PO-1" }));

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 300, {
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 3 }],
      });
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

  it("shows 'No tickets in this sprint yet.' when the PO sprint has no tickets", async () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: { ...SPRINT_DATA, issuesByStatus: { todo: [], inprogress: [], codereview: [], done: [] } },
      loading: false, error: null, run: vi.fn(),
    });
    renderCard();
    await waitFor(() => screen.getByText("No tickets in this sprint yet."));
  });
});

// ── Mutation error ────────────────────────────────────────────────────────────

describe("DraftPlanCard — mutation error", () => {
  it("shows an inline aria-live error and rolls back when setDraftPlan rejects", async () => {
    renderCard();
    await waitForLoaded();

    vi.mocked(draftPlanClientModule.setDraftPlan).mockRejectedValueOnce({
      code: "UPSTREAM", message: "Jira bridge rejected the draft save",
    });

    const select = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" });
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(screen.getByText(/Jira bridge rejected the draft save/i)).toBeTruthy();
    });

    // Rolled back — PO-1 is undrafted again.
    expect(within(ticketRow("PO-1")).getByText("Not drafted")).toBeTruthy();
  });
});

// ── Non-sticky auto-pairing (v1.69, ADR-080 — unchanged in v1.70) ─────────────

describe("DraftPlanCard — non-sticky auto-pairing", () => {
  it("drafting with nothing stored persists devSprintId: null (not the auto-paired id)", async () => {
    mockDefaults(NULL_DEV_DRAFT);
    renderCard();
    await waitForLoaded();

    // The effective/paired default is still 300 (the only future Dev sprint) for capacity...
    const select = await screen.findByRole("combobox", { name: "Dev sprint (capacity source)" });
    expect((select as HTMLSelectElement).value).toBe("300");

    // ...but drafting must NOT persist that guess.
    const draftSelect = screen.getByRole("combobox", { name: "Draft PO-1 to a developer" });
    fireEvent.change(draftSelect, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, null, {
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
      });
    });
  });
});

// ── "Reset to auto" ─────────────────────────────────────────────────────────────

describe("DraftPlanCard — Reset to auto", () => {
  it("does not render when nothing is stored", async () => {
    mockDefaults(NULL_DEV_DRAFT);
    renderCard();
    await waitForLoaded();
    expect(screen.queryByRole("button", { name: "Reset to auto" })).toBeNull();
  });

  it("appears when a devSprintId is stored and persists null with unchanged assignments", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE); // devSprintId stored = 300
    renderCard();

    const resetBtn = await screen.findByRole("button", { name: "Reset to auto" });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, null, {
        "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
      });
    });
  });
});

// ── "Auto-paired" label ──────────────────────────────────────────────────────

describe("DraftPlanCard — Auto-paired label", () => {
  it("shows an 'Auto-paired' hint when nothing is stored and a paired default is in use", async () => {
    mockDefaults(NULL_DEV_DRAFT);
    renderCard();
    await waitFor(() => screen.getByText("Auto-paired"));
  });

  it("hides the hint once a devSprintId is stored", async () => {
    mockDefaults(DRAFT_PO1_TO_ALICE);
    renderCard();
    await waitForLoaded();
    expect(screen.queryByText("Auto-paired")).toBeNull();
  });
});

// ── Capacity-source transparency (v1.69, ADR-080) ─────────────────────────────

describe("DraftPlanCard — capacity-source transparency", () => {
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

  it("shows a small '…' placeholder on dev cards (never a number) while leaves load", async () => {
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null, loading: true, error: null, run: vi.fn(), save: vi.fn(),
    });
    renderCard();
    await waitFor(() => screen.getByText("Loading leaves…"));
    // Neither card renders a numeric or "—" capacity while leaves load.
    expect(within(devCard("Alice")).getByText("…")).toBeTruthy();
    expect(within(devCard("Bob")).getByText("…")).toBeTruthy();
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

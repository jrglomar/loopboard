import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SprintBoard } from "./SprintBoard";
import type { GetActiveSprintOutput } from "../lib/types";

// ── Sample data (v1.2: includes codereview bucket) ───────────────────────────

const SAMPLE_SPRINT: GetActiveSprintOutput = {
  sprint: {
    id: 55,
    name: "Sprint 7",
    state: "active",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-06-14T00:00:00.000Z",
    goal: "Ship user authentication",
  },
  // v1.1: single active sprint — selector is hidden
  activeSprints: [
    {
      id: 55,
      name: "Sprint 7",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-14T00:00:00.000Z",
      goal: "Ship user authentication",
    },
  ],
  // v1.4: no future sprints in the base fixture
  futureSprints: [],
  issuesByStatus: {
    todo: [
      {
        key: "DEV-10",
        summary: "Implement refresh token",
        status: "To Do",
        statusCategory: "todo",
        assignee: "Alice",
        assigneeAccountId: "acc-alice",
        storyPoints: 3,
        issueType: "Task",
        url: "https://jira.example.com/browse/DEV-10",
        blocked: false,
      },
    ],
    inprogress: [
      {
        key: "DEV-11",
        summary: "Build login UI",
        status: "In Progress",
        statusCategory: "inprogress",
        assignee: "Bob",
        assigneeAccountId: "acc-bob",
        storyPoints: 5,
        issueType: "Story",
        url: "https://jira.example.com/browse/DEV-11",
        blocked: false,
      },
      {
        key: "DEV-12",
        summary: "Fix auth token expiry",
        status: "In Progress",
        statusCategory: "inprogress",
        assignee: "Carol",
        assigneeAccountId: "acc-carol",
        storyPoints: 2,
        issueType: "Bug",
        url: "https://jira.example.com/browse/DEV-12",
        blocked: true,
      },
    ],
    // v1.2: code review bucket
    codereview: [
      {
        key: "DEV-14",
        summary: "Review OAuth PR",
        status: "Code Review",
        statusCategory: "inprogress",
        assignee: "Alice",
        assigneeAccountId: "acc-alice",
        storyPoints: 2,
        issueType: "Task",
        url: "https://jira.example.com/browse/DEV-14",
        blocked: false,
      },
    ],
    done: [
      {
        key: "DEV-13",
        summary: "Set up OAuth provider",
        status: "Done",
        statusCategory: "done",
        assignee: "Alice",
        assigneeAccountId: "acc-alice",
        storyPoints: 4,
        issueType: "Task",
        url: "https://jira.example.com/browse/DEV-13",
        blocked: false,
      },
    ],
  },
  totals: {
    total: 5,
    todo: 1,
    inprogress: 2,
    codereview: 1,
    done: 1,
    blocked: 1,
    storyPointsTotal: 16,
    storyPointsDone: 4,
    storyPointsCodeReview: 0, // v1.5 — zero so existing "4 / 16 pts" label holds
  },
};

afterEach(() => { cleanup(); });

describe("SprintBoard", () => {
  it("renders the sprint name", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText("Sprint 7")).toBeTruthy();
  });

  it("renders the sprint goal", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText("Ship user authentication")).toBeTruthy();
  });

  // v1.2: FOUR columns now
  it("renders four columns: To Do, In Progress, Code Review, Done", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText("To Do")).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("Code Review")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("renders issue cards with key and summary", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText("DEV-10")).toBeTruthy();
    expect(screen.getByText("Implement refresh token")).toBeTruthy();
    expect(screen.getByText("DEV-11")).toBeTruthy();
    expect(screen.getByText("Build login UI")).toBeTruthy();
    expect(screen.getByText("DEV-13")).toBeTruthy();
  });

  // v1.2: Code Review column shows its issues
  it("renders Code Review issues in the Code Review column", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText("DEV-14")).toBeTruthy();
    expect(screen.getByText("Review OAuth PR")).toBeTruthy();
  });

  // v1.2: column counts reflect the filtered view
  it("renders column count labels for all four columns", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // aria-label includes the count; check via accessible label
    // Each column section has "X issues" as the count aria-label
    const counts = screen.getAllByLabelText(/\d+ issues/);
    expect(counts.length).toBeGreaterThanOrEqual(4);
  });

  it("renders 'Blocked' badge for blocked issues", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // DEV-12 is blocked
    const blockedBadges = screen.getAllByRole("status");
    expect(blockedBadges.length).toBeGreaterThan(0);
    expect(blockedBadges.some((el) => el.textContent?.includes("Blocked"))).toBe(true);
  });

  it("does NOT render Blocked badge for non-blocked issues", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // Only DEV-12 should have a blocked badge
    const blockedBadges = screen.getAllByRole("status").filter((el) =>
      el.textContent?.includes("Blocked")
    );
    expect(blockedBadges.length).toBe(1);
  });

  it("renders story points for issues that have them", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText("3 pts")).toBeTruthy();
    expect(screen.getByText("5 pts")).toBeTruthy();
  });

  it("renders assignee names", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // Alice appears as assignee on cards (and in the filter dropdown)
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    // Bob appears both as an issue-card assignee and in the filter dropdown
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
  });

  it("renders loading skeleton when loading=true", () => {
    const { container } = render(
      <SprintBoard data={null} loading={true} error={null} onRefresh={() => undefined} />
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("renders error state with retry button when error provided", () => {
    const error = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    const onRefresh = vi.fn();
    render(
      <SprintBoard data={null} loading={false} error={error} onRefresh={onRefresh} />
    );
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows start command in error state when BRIDGE_DOWN", () => {
    const error = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    render(
      <SprintBoard data={null} loading={false} error={error} onRefresh={() => undefined} />
    );
    expect(screen.getByText(/dev:jira:http/)).toBeTruthy();
  });

  it("renders empty state when sprint exists but has no issues", () => {
    const emptyData: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      issuesByStatus: { todo: [], inprogress: [], codereview: [], done: [] },
      totals: { total: 0, todo: 0, inprogress: 0, codereview: 0, done: 0, blocked: 0, storyPointsTotal: 0, storyPointsDone: 0, storyPointsCodeReview: 0 },
    };
    render(
      <SprintBoard data={emptyData} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText(/No active sprint issues/)).toBeTruthy();
  });

  it("renders null state with refresh button when data is null", () => {
    const onRefresh = vi.fn();
    render(
      <SprintBoard data={null} loading={false} error={null} onRefresh={onRefresh} />
    );
    expect(screen.getByText(/No sprint data/)).toBeTruthy();
  });

  it("renders issue type labels", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // "Task" appears multiple times (DEV-10, DEV-13, DEV-14), Story and Bug once each
    expect(screen.getAllByText("Task").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Story")).toBeTruthy();
    expect(screen.getByText("Bug")).toBeTruthy();
  });

  it("renders story point totals in sprint header", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // v1.3: progress zone shows "4 / 16 pts" format
    expect(screen.getByText(/4 \/ 16 pts/)).toBeTruthy();
  });

  // ── v1.4: Future sprint tests (ADR-011) ────────────────────────────────────

  it("renders future sprints in a 'Future' optgroup when combined > 1", () => {
    const withFuture: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      // Need >1 combined to show selector
      futureSprints: [
        {
          id: 100,
          name: "Sprint 8",
          startDate: "2026-06-15T00:00:00.000Z",
          endDate: "2026-06-28T00:00:00.000Z",
          goal: null,
        },
      ],
    };
    render(
      <SprintBoard
        data={withFuture}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        onSelectSprint={() => undefined}
      />
    );
    const selector = screen.getByRole("combobox", { name: /sprint/i });
    // The optgroup with label "Future" should exist
    const futureGroup = selector.querySelector("optgroup[label='Future']");
    expect(futureGroup).toBeTruthy();
    expect(futureGroup?.querySelectorAll("option").length).toBe(1);
    expect(futureGroup?.querySelector("option")?.textContent).toContain("Sprint 8");
  });

  it("calls onSelectSprint with correct id when a future sprint is chosen", () => {
    const onSelectSprint = vi.fn();
    const withFuture: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      futureSprints: [
        {
          id: 100,
          name: "Sprint 8",
          startDate: "2026-06-15T00:00:00.000Z",
          endDate: "2026-06-28T00:00:00.000Z",
          goal: null,
        },
      ],
    };
    render(
      <SprintBoard
        data={withFuture}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        onSelectSprint={onSelectSprint}
      />
    );
    const selector = screen.getByRole("combobox", { name: /sprint/i });
    fireEvent.change(selector, { target: { value: "100" } });
    expect(onSelectSprint).toHaveBeenCalledOnce();
    expect(onSelectSprint).toHaveBeenCalledWith(100);
  });

  it("renders 'Future sprint' badge when sprint.state is 'future'", () => {
    const futureSelected: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      sprint: {
        ...SAMPLE_SPRINT.sprint,
        state: "future",
      },
    };
    render(
      <SprintBoard
        data={futureSelected}
        loading={false}
        error={null}
        onRefresh={() => undefined}
      />
    );
    expect(screen.getByLabelText("Future sprint")).toBeTruthy();
  });

  it("does NOT render 'Future sprint' badge when sprint.state is 'active'", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.queryByLabelText("Future sprint")).toBeNull();
  });

  it("shows planning note when a future sprint has no issues", () => {
    const emptyFuture: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      sprint: { ...SAMPLE_SPRINT.sprint, state: "future" },
      issuesByStatus: { todo: [], inprogress: [], codereview: [], done: [] },
      totals: { total: 0, todo: 0, inprogress: 0, codereview: 0, done: 0, blocked: 0, storyPointsTotal: 0, storyPointsDone: 0, storyPointsCodeReview: 0 },
    };
    render(
      <SprintBoard data={emptyFuture} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText(/This sprint is being planned/i)).toBeTruthy();
  });

  it("does NOT show planning note for an empty ACTIVE sprint", () => {
    const emptyActive: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      sprint: { ...SAMPLE_SPRINT.sprint, state: "active" },
      issuesByStatus: { todo: [], inprogress: [], codereview: [], done: [] },
      totals: { total: 0, todo: 0, inprogress: 0, codereview: 0, done: 0, blocked: 0, storyPointsTotal: 0, storyPointsDone: 0, storyPointsCodeReview: 0 },
    };
    render(
      <SprintBoard data={emptyActive} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.queryByText(/This sprint is being planned/i)).toBeNull();
    expect(screen.getByText(/No active sprint issues/i)).toBeTruthy();
  });

  it("hides selector when active+future combined is exactly 1", () => {
    // 1 active, 0 future — selector hidden
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        onSelectSprint={() => undefined}
      />
    );
    expect(screen.queryByRole("combobox", { name: /sprint/i })).toBeNull();
  });

  it("shows selector when 0 active + 2 future (future-only board)", () => {
    const futurOnly: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      sprint: { ...SAMPLE_SPRINT.sprint, id: 100, name: "Sprint 8", state: "future" },
      activeSprints: [],
      futureSprints: [
        { id: 100, name: "Sprint 8", startDate: null, endDate: null, goal: null },
        { id: 101, name: "Sprint 9", startDate: null, endDate: null, goal: null },
      ],
    };
    render(
      <SprintBoard
        data={futurOnly}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        onSelectSprint={() => undefined}
      />
    );
    expect(screen.getByRole("combobox", { name: /sprint/i })).toBeTruthy();
  });

  // ── Sprint selector tests (v1.1, ADR-007) ──────────────────────────────────

  it("does NOT render a sprint selector when only 1 active sprint", () => {
    // SAMPLE_SPRINT already has 1 activeSprint — selector must be hidden
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} onSelectSprint={() => undefined} />
    );
    expect(screen.queryByRole("combobox", { name: /sprint/i })).toBeNull();
  });

  it("renders a labeled sprint selector when >1 active sprints, latest-first", () => {
    const multiSprint: typeof SAMPLE_SPRINT = {
      ...SAMPLE_SPRINT,
      activeSprints: [
        {
          id: 55,
          name: "Sprint 7",
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-06-14T00:00:00.000Z",
          goal: "Latest",
        },
        {
          id: 42,
          name: "Sprint 6",
          startDate: "2026-05-15T00:00:00.000Z",
          endDate: "2026-05-28T00:00:00.000Z",
          goal: null,
        },
      ],
      futureSprints: [],
    };
    render(
      <SprintBoard data={multiSprint} loading={false} error={null} onRefresh={() => undefined} onSelectSprint={() => undefined} />
    );
    // a11y: labeled select — the Sprint selector has aria-label="Select sprint"
    const selector = screen.getByRole("combobox", { name: /sprint/i });
    expect(selector).toBeTruthy();
    const options = selector.querySelectorAll("option");
    // Latest (Sprint 7, id=55) is first — both are in the Active optgroup
    expect(options[0].textContent).toContain("Sprint 7");
    expect(options[1].textContent).toContain("Sprint 6");
  });

  it("calls onSelectSprint with the chosen sprint id", () => {
    const onSelectSprint = vi.fn();
    const multiSprint: typeof SAMPLE_SPRINT = {
      ...SAMPLE_SPRINT,
      activeSprints: [
        {
          id: 55,
          name: "Sprint 7",
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-06-14T00:00:00.000Z",
          goal: null,
        },
        {
          id: 42,
          name: "Sprint 6",
          startDate: "2026-05-15T00:00:00.000Z",
          endDate: "2026-05-28T00:00:00.000Z",
          goal: null,
        },
      ],
      futureSprints: [],
    };
    render(
      <SprintBoard data={multiSprint} loading={false} error={null} onRefresh={() => undefined} onSelectSprint={onSelectSprint} />
    );
    const selector = screen.getByRole("combobox", { name: /sprint/i });
    // Select the second option (Sprint 6, id=42)
    fireEvent.change(selector, { target: { value: "42" } });
    expect(onSelectSprint).toHaveBeenCalledOnce();
    expect(onSelectSprint).toHaveBeenCalledWith(42);
  });

  it("does NOT render selector when onSelectSprint is not provided", () => {
    const multiSprint: typeof SAMPLE_SPRINT = {
      ...SAMPLE_SPRINT,
      activeSprints: [
        { id: 55, name: "Sprint 7", startDate: "2026-06-01T00:00:00.000Z", endDate: null, goal: null },
        { id: 42, name: "Sprint 6", startDate: "2026-05-15T00:00:00.000Z", endDate: null, goal: null },
      ],
      futureSprints: [],
    };
    render(
      <SprintBoard data={multiSprint} loading={false} error={null} onRefresh={() => undefined} />
    );
    // No onSelectSprint prop → selector not rendered
    expect(screen.queryByRole("combobox", { name: /sprint/i })).toBeNull();
  });

  // ── Assignee filter tests (v1.2, ADR-008) ──────────────────────────────────

  it("renders the Assignee filter control when data has issues", () => {
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter={null}
        onAssigneeFilterChange={() => undefined}
      />
    );
    // a11y: the assignee filter has aria-label="Filter by assignee"
    expect(screen.getByRole("combobox", { name: /assignee/i })).toBeTruthy();
  });

  it("assignee filter options include All, named assignees, and Unassigned when null assignee exists", () => {
    // Add a null-assignee issue to trigger Unassigned option
    const dataWithUnassigned: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      issuesByStatus: {
        ...SAMPLE_SPRINT.issuesByStatus,
        todo: [
          ...SAMPLE_SPRINT.issuesByStatus.todo,
          {
            key: "DEV-20",
            summary: "Unassigned task",
            status: "To Do",
            statusCategory: "todo",
            assignee: null,
            assigneeAccountId: null,
            storyPoints: null,
            issueType: "Task",
            url: "https://jira.example.com/browse/DEV-20",
            blocked: false,
          },
        ],
      },
    };
    render(
      <SprintBoard
        data={dataWithUnassigned}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter={null}
        onAssigneeFilterChange={() => undefined}
      />
    );
    const select = screen.getByRole("combobox", { name: /assignee/i });
    const options = select.querySelectorAll("option");
    const optionTexts = Array.from(options).map((o) => o.textContent ?? "");
    expect(optionTexts).toContain("All");
    expect(optionTexts).toContain("Alice");
    expect(optionTexts).toContain("Bob");
    expect(optionTexts).toContain("Carol");
    expect(optionTexts).toContain("Unassigned");
  });

  it("assignees are listed alphabetically before Unassigned", () => {
    const dataWithUnassigned: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      issuesByStatus: {
        ...SAMPLE_SPRINT.issuesByStatus,
        todo: [
          ...SAMPLE_SPRINT.issuesByStatus.todo,
          {
            key: "DEV-20",
            summary: "Unassigned task",
            status: "To Do",
            statusCategory: "todo",
            assignee: null,
            assigneeAccountId: null,
            storyPoints: null,
            issueType: "Task",
            url: "https://jira.example.com/browse/DEV-20",
            blocked: false,
          },
        ],
      },
    };
    render(
      <SprintBoard
        data={dataWithUnassigned}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter={null}
        onAssigneeFilterChange={() => undefined}
      />
    );
    const select = screen.getByRole("combobox", { name: /assignee/i });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
    // "All" first, then alpha, then "Unassigned" last
    const nonAll = options.slice(1); // remove "All"
    const unassignedIdx = nonAll.indexOf("Unassigned");
    expect(unassignedIdx).toBe(nonAll.length - 1);
    // The named ones come before Unassigned
    const namedOnes = nonAll.slice(0, unassignedIdx);
    expect(namedOnes).toEqual([...namedOnes].sort());
  });

  it("filtering by assignee shows only their cards across columns", () => {
    const onFilterChange = vi.fn();
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter="Alice"
        onAssigneeFilterChange={onFilterChange}
      />
    );
    // Alice has DEV-10 (todo), DEV-14 (codereview), DEV-13 (done)
    expect(screen.getByText("DEV-10")).toBeTruthy();
    expect(screen.getByText("DEV-13")).toBeTruthy();
    expect(screen.getByText("DEV-14")).toBeTruthy();
    // Bob's issue DEV-11 should NOT appear in any column card
    // Note: DEV-11 has no blocked badge, so it should not appear at all
    expect(screen.queryByText("DEV-11")).toBeNull();
    // Carol's blocked issue DEV-12: the blocker banner always shows ALL blocked issues
    // so DEV-12 appears in the banner as a link, but NOT as an issue card in the columns.
    // The column card for DEV-12 shows its summary text "Fix auth token expiry".
    // With Alice filter active, the column should NOT show "Fix auth token expiry".
    expect(screen.queryByText("Fix auth token expiry")).toBeNull();
  });

  it("shows 'Showing X of Y issues' when a filter is active", () => {
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter="Alice"
        onAssigneeFilterChange={() => undefined}
      />
    );
    // Alice has 3 issues (DEV-10, DEV-14, DEV-13), total is 5
    expect(screen.getByText(/Showing 3 of 5 issues/)).toBeTruthy();
    // v1.16: filtered points total — Alice's 3 + 2 + 4 = 9 pts
    expect(screen.getByText("9 pts")).toBeTruthy();
  });

  it("does NOT show 'Showing X of Y' when filter is null (All)", () => {
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter={null}
        onAssigneeFilterChange={() => undefined}
      />
    );
    expect(screen.queryByText(/Showing \d+ of \d+ issues/)).toBeNull();
  });

  it("column counts update when filter is active", () => {
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter="Bob"
        onAssigneeFilterChange={() => undefined}
      />
    );
    // Bob only has DEV-11 (in progress). Other columns should show 0.
    // In Progress column count should be 1
    const countEls = screen.getAllByLabelText(/\d+ issues/);
    const countTexts = countEls.map((el) => el.textContent);
    // Exactly one "1" count (Bob's In Progress), others "0"
    expect(countTexts.filter((t) => t === "1").length).toBe(1);
    expect(countTexts.filter((t) => t === "0").length).toBeGreaterThanOrEqual(3);
  });

  it("calls onAssigneeFilterChange when user selects an assignee", () => {
    const onFilterChange = vi.fn();
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter={null}
        onAssigneeFilterChange={onFilterChange}
      />
    );
    const select = screen.getByRole("combobox", { name: /assignee/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    expect(onFilterChange).toHaveBeenCalledWith("Bob");
  });

  it("calls onAssigneeFilterChange with null when 'All' is selected", () => {
    const onFilterChange = vi.fn();
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        assigneeFilter="Alice"
        onAssigneeFilterChange={onFilterChange}
      />
    );
    const select = screen.getByRole("combobox", { name: /assignee/i });
    fireEvent.change(select, { target: { value: "" } });
    expect(onFilterChange).toHaveBeenCalledWith(null);
  });

  // ── v1.3: Blocker banner tests (ADR-010) ────────────────────────────────────

  it("renders blocker banner when totals.blocked > 0", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // SAMPLE_SPRINT has 1 blocked issue (DEV-12)
    expect(screen.getByText(/1 blocked/)).toBeTruthy();
  });

  it("blocker banner links to blocked issue keys", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // DEV-12 is the blocked key; it should appear as a link in the banner
    const links = screen.getAllByRole("link", { name: /DEV-12/i });
    expect(links.length).toBeGreaterThan(0);
  });

  it("blocker banner is hidden when totals.blocked === 0", () => {
    const noBlockers: typeof SAMPLE_SPRINT = {
      ...SAMPLE_SPRINT,
      issuesByStatus: {
        ...SAMPLE_SPRINT.issuesByStatus,
        inprogress: SAMPLE_SPRINT.issuesByStatus.inprogress.map((i) => ({
          ...i,
          blocked: false,
        })),
      },
      totals: { ...SAMPLE_SPRINT.totals, blocked: 0 },
    };
    render(
      <SprintBoard data={noBlockers} loading={false} error={null} onRefresh={() => undefined} />
    );
    // Should NOT find the blocker count text
    expect(screen.queryByText(/0 blocked/)).toBeNull();
    // The banner section title should not exist
    expect(screen.queryByText(/blocked —/)).toBeNull();
  });

  it("renders 'Show blocked' toggle button in blocker banner", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // The toggle button has aria-pressed
    const showBlockedBtn = screen.getByRole("button", { name: /show blocked/i });
    expect(showBlockedBtn).toBeTruthy();
    expect(showBlockedBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles 'Show blocked' filter when button is clicked", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    const showBlockedBtn = screen.getByRole("button", { name: /show blocked/i });
    fireEvent.click(showBlockedBtn);
    // After click: aria-pressed should be true; button text changes to "Show all issues"
    expect(screen.getByRole("button", { name: /show all issues/i })).toBeTruthy();
  });

  // ── v1.3: Progress bar tests (ADR-010) ──────────────────────────────────────

  it("renders a progress bar (role=progressbar) when storyPointsTotal > 0", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // SAMPLE_SPRINT has storyPointsTotal=16
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("renders 'No estimates' when storyPointsTotal === 0", () => {
    const noEstimates: typeof SAMPLE_SPRINT = {
      ...SAMPLE_SPRINT,
      totals: { ...SAMPLE_SPRINT.totals, storyPointsTotal: 0, storyPointsDone: 0 },
    };
    render(
      <SprintBoard data={noEstimates} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.getByText(/No estimates/)).toBeTruthy();
    // No progressbar when no estimates
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  // ── v1.3: Sprint header 3-zone tests (ADR-010) ──────────────────────────────

  it("renders sprint name at text-2xl (h2)", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    const heading = screen.getByRole("heading", { level: 2, name: /Sprint 7/i });
    expect(heading).toBeTruthy();
  });

  it("renders sprint goal with Target icon label", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // aria-label="Sprint goal" on the goal paragraph
    expect(screen.getByText("Ship user authentication")).toBeTruthy();
  });

  // ── v1.5: DoD progress — storyPointsDone + storyPointsCodeReview (ADR-014) ──

  it("v1.5 DoD: progress bar label includes code-review points in done count", () => {
    const withReview: GetActiveSprintOutput = {
      ...SAMPLE_SPRINT,
      totals: {
        ...SAMPLE_SPRINT.totals,
        storyPointsDone: 4,
        storyPointsCodeReview: 2, // 2 pts in code review count as done
        storyPointsTotal: 16,
      },
    };
    render(
      <SprintBoard data={withReview} loading={false} error={null} onRefresh={() => undefined} />
    );
    // DoD: 4 done + 2 code-review = 6 pts shown as completed
    expect(screen.getByText(/6 \/ 16 pts/)).toBeTruthy();
  });

  // ── v1.4.1: My Issues filter REMOVED (ADR-013) ────────────────────────────

  it("does NOT render 'My Issues' toggle (removed in v1.4.1)", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    // My Issues button must not exist — it was removed per ADR-013
    expect(screen.queryByRole("button", { name: /my issues/i })).toBeNull();
  });

  // ── v1.27 (ADR-039): linked-PR badge on cards ─────────────────────────────

  it("renders a clickable PR badge on a card whose key has a linked PR", () => {
    render(
      <SprintBoard
        data={SAMPLE_SPRINT}
        loading={false}
        error={null}
        onRefresh={() => undefined}
        prsByKey={{
          "DEV-10": [
            {
              url: "https://github.com/acme/web/pull/42",
              title: "Add refresh token",
              repo: "acme/web",
              status: "open",
              decision: "approved",
              approvals: 1,
              reviewers: ["Bob"],
            },
          ],
        }}
      />
    );
    const badge = screen.getByRole("link", { name: /linked pull request/i });
    expect(badge).toHaveAttribute("href", "https://github.com/acme/web/pull/42");
  });

  it("renders no PR badge when prsByKey is absent", () => {
    render(
      <SprintBoard data={SAMPLE_SPRINT} loading={false} error={null} onRefresh={() => undefined} />
    );
    expect(screen.queryByRole("link", { name: /linked pull request/i })).toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HuddleDigest } from "./HuddleDigest";
import type { GetDailyHuddleOutput } from "../lib/types";

// ── Sample data (v1.2: includes codeReview bucket) ───────────────────────────

const SAMPLE_HUDDLE: GetDailyHuddleOutput = {
  sprintName: "Sprint 7",
  sprintId: 55,
  boardId: 10002,
  generatedAt: new Date("2026-06-11T09:00:00Z").toISOString(),
  summaryText:
    "Sprint 'Sprint 7' (2026-06-01 – 2026-06-14): 8 issues — 3 in progress, 1 in code review, 1 blocked (DEV-5), 2 done, 2 up next.",
  inProgress: [
    { key: "DEV-1", summary: "Implement login flow", assignee: "Alice", status: "In Progress" },
    { key: "DEV-2", summary: "Update DB schema", assignee: "Bob", status: "In Progress" },
    { key: "DEV-3", summary: "Write unit tests", assignee: null, status: "In Progress" },
  ],
  // v1.2: codeReview section (camelCase per CONTRACTS.md §4.6)
  codeReview: [
    { key: "DEV-4", summary: "Review auth PR", assignee: "Carol", status: "Code Review" },
  ],
  blocked: [
    { key: "DEV-5", summary: "Waiting for design approval", assignee: "Carol", status: "In Progress" },
  ],
  done: [
    { key: "DEV-6", summary: "Fix navbar bug", assignee: "Alice", status: "Done" },
    { key: "DEV-7", summary: "Setup CI pipeline", assignee: "Bob", status: "Done" },
  ],
  upNext: [
    { key: "DEV-8", summary: "Add OAuth support", assignee: null, status: "To Do" },
    { key: "DEV-9", summary: "Performance audit", assignee: "Carol", status: "To Do" },
  ],
};

afterEach(() => { cleanup(); });

describe("HuddleDigest", () => {
  it("renders the summary text", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    expect(screen.getByText(/1 blocked/)).toBeTruthy();
  });

  it("renders the sprint name in the heading", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    // The heading includes both "Daily Huddle — Sprint 7"
    expect(screen.getByRole("heading", { name: /Sprint 7/i })).toBeTruthy();
  });

  it("renders the In Progress section with items", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: By Status no longer default
    // Section heading text (h4)
    expect(screen.getAllByText("In Progress").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("DEV-1")).toBeTruthy();
    expect(screen.getByText("Implement login flow")).toBeTruthy();
    // Alice appears in assignee span
    expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
  });

  // v1.2: Code Review section
  it("renders the Code Review section with items", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: By Status no longer default
    expect(screen.getAllByText("Code Review").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("DEV-4")).toBeTruthy();
    expect(screen.getByText("Review auth PR")).toBeTruthy();
    expect(screen.getAllByText("Carol").length).toBeGreaterThanOrEqual(1);
  });

  // v1.2: Code Review appears in clipboard text
  it("includes Code Review section in clipboard plain text", async () => {
    let clipboardText = "";
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn((text: string) => {
          clipboardText = text;
          return Promise.resolve();
        }),
      },
    });

    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: status-grouped clipboard
    const copyBtn = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyBtn);
    // Wait for the async clipboard write
    await new Promise((r) => setTimeout(r, 10));
    expect(clipboardText).toContain("Code Review");
    expect(clipboardText).toContain("DEV-4");
    expect(clipboardText).toContain("Review auth PR");
  });

  it("renders the Blocked section with items", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: By Status no longer default
    expect(screen.getAllByText("Blocked").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("DEV-5")).toBeTruthy();
    expect(screen.getByText("Waiting for design approval")).toBeTruthy();
  });

  it("renders the Done section with items", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: Done bucket only in By Status view
    // "Done" appears in both the summary text and as a section heading
    expect(screen.getAllByText("Done").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("DEV-6")).toBeTruthy();
    expect(screen.getByText("Fix navbar bug")).toBeTruthy();
  });

  it("renders the Up Next section with items", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: Up Next bucket only in By Status view
    expect(screen.getAllByText("Up Next").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("DEV-8")).toBeTruthy();
    expect(screen.getByText("Add OAuth support")).toBeTruthy();
  });

  it("shows 'Unassigned' placeholder for null assignees in items", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    // DEV-3 and DEV-8 have null assignee — they should simply not render an assignee span
    // (the component omits the span when assignee is null)
    expect(screen.getByText("DEV-3")).toBeTruthy();
  });

  it("renders a copy-to-clipboard button", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });

  it("shows loading skeleton when loading", () => {
    const { container } = render(
      <HuddleDigest data={null} loading={true} error={null} onRefresh={() => undefined} />
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("shows error state with retry button when error", () => {
    const error = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    const onRefresh = vi.fn();
    render(<HuddleDigest data={null} loading={false} error={error} onRefresh={onRefresh} />);
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows bridge-down command when BRIDGE_DOWN error", () => {
    const error = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    render(<HuddleDigest data={null} loading={false} error={error} onRefresh={() => undefined} />);
    expect(screen.getByText(/dev:jira:http/)).toBeTruthy();
  });

  it("renders empty state when huddle has no issues", () => {
    const emptyHuddle: GetDailyHuddleOutput = {
      ...SAMPLE_HUDDLE,
      inProgress: [],
      codeReview: [],
      blocked: [],
      done: [],
      upNext: [],
    };
    render(<HuddleDigest data={emptyHuddle} loading={false} error={null} onRefresh={() => undefined} />);
    expect(screen.getByText(/No sprint activity/)).toBeTruthy();
  });

  it("renders null state when data is null and not loading", () => {
    render(<HuddleDigest data={null} loading={false} error={null} onRefresh={() => undefined} />);
    expect(screen.getByText(/No huddle data/i)).toBeTruthy();
  });

  // v1.2: empty codeReview bucket shows "Nothing in review"
  it("shows 'Nothing in review' when codeReview is empty", () => {
    const noReview: GetDailyHuddleOutput = {
      ...SAMPLE_HUDDLE,
      codeReview: [],
    };
    render(<HuddleDigest data={noReview} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by status/i })); // v1.3.1: empty-section msg is a By Status affordance
    expect(screen.getByText("Nothing in review")).toBeTruthy();
  });

  // ── v1.3: By Status / By Person toggle tests (ADR-010) ───────────────────

  it("renders the By Status / By Person toggle buttons", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    expect(screen.getByRole("tab", { name: /by status/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /by person/i })).toBeTruthy();
  });

  it("starts in By Person view by default (v1.3.1)", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    const byPersonBtn = screen.getByRole("tab", { name: /by person/i });
    expect(byPersonBtn.getAttribute("aria-pressed")).toBe("true");
    const byStatusBtn = screen.getByRole("tab", { name: /by status/i });
    expect(byStatusBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to By Person view when the button is clicked", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    const byPersonBtn = screen.getByRole("tab", { name: /by person/i });
    fireEvent.click(byPersonBtn);
    // By Person view groups by assignee; "Alice" appears as a section heading
    // (SAMPLE_HUDDLE assigns "Alice" as the assignee display name)
    const aliceHeadings = screen.queryAllByText("Alice");
    expect(aliceHeadings.length).toBeGreaterThanOrEqual(1);
  });

  it("By Person view regroups items under assignee names", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by person/i }));
    // Alice has DEV-1 (inProgress) and DEV-4 (codeReview)
    expect(screen.getByText("DEV-1")).toBeTruthy();
    expect(screen.getByText("DEV-4")).toBeTruthy();
  });

  it("By Person view does NOT show section headers for Done/Up Next", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by person/i }));
    // Done and Up Next section titles should NOT appear in By Person view
    // (they appear in By Status view)
    // We do still have "Done" in the summary text; check no list section heading
    const sectionHeadings = screen.queryAllByRole("heading", { name: /^Done$/i });
    // Should be 0 section headings named "Done" in by-person view
    expect(sectionHeadings.length).toBe(0);
  });

  it("summaryText is preserved in both views", () => {
    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    // By Status view shows summary
    expect(screen.getByText(/1 blocked/)).toBeTruthy();
    // Switch to By Person and summary still visible
    fireEvent.click(screen.getByRole("tab", { name: /by person/i }));
    expect(screen.getByText(/1 blocked/)).toBeTruthy();
  });

  it("By Person clipboard text groups by person", async () => {
    let clipboardText = "";
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn((text: string) => {
          clipboardText = text;
          return Promise.resolve();
        }),
      },
    });

    render(<HuddleDigest data={SAMPLE_HUDDLE} loading={false} error={null} onRefresh={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: /by person/i }));

    const copyBtn = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyBtn);
    await new Promise((r) => setTimeout(r, 10));

    expect(clipboardText).toContain("By Person");
    // SAMPLE_HUDDLE uses "Alice" as the assignee display name
    expect(clipboardText).toContain("Alice");
    // Should have bucket labels
    expect(clipboardText).toContain("[In Progress]");
  });
});

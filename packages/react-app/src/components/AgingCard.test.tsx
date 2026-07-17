// AgingCard tests — v1.58, ADR-070. Keyless/offline (no mocks needed; pure props in).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { AgingCard } from "./AgingCard";
import type { IssueSummary, AgingPolicy } from "../lib/types";

const POLICY: AgingPolicy = { baseDays: 1, daysPerPoint: 1 };

/** An in-progress issue that entered its status `daysAgo` days before now. */
function aged(key: string, daysAgo: number, over: Partial<IssueSummary> = {}): IssueSummary {
  const since = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    key, summary: `${key} summary`, status: "In Progress", statusCategory: "inprogress",
    assignee: "Alice", assigneeAccountId: "a1", storyPoints: 1, issueType: "Task",
    url: `https://j/browse/${key}`, blocked: false, inProgressSince: since, ...over,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear(); // useCollapse persists per key
});

describe("AgingCard (v1.58)", () => {
  it("lists aged tickets worst-first with their age and detail", () => {
    render(<AgingCard issues={[aged("DEV-1", 1, { storyPoints: 5 }), aged("DEV-9", 6)]} policy={POLICY} />);
    const list = screen.getByRole("list", { name: /ticket aging/i });
    const items = within(list).getAllByRole("listitem");
    // DEV-9: 6d vs expected 2d (250%) beats DEV-1: 1d vs 6d (17%)
    expect(items[0]!.textContent).toContain("DEV-9");
    expect(items[1]!.textContent).toContain("DEV-1");
    expect(list.textContent).toContain("6d in In Progress (expected ~2d for 1 pt)");
  });

  it("summarises the tier counts", () => {
    render(
      <AgingCard
        issues={[aged("A", 0, { storyPoints: 5 }), aged("B", 2, { storyPoints: 1 }), aged("C", 9, { storyPoints: 1 })]}
        policy={POLICY}
      />
    );
    // A 0/6 ok · B 2/2 watch · C 9/2 overdue
    expect(screen.getByText("1 overdue · 1 watch · 1 ok")).toBeTruthy();
  });

  it("badges only the flagged (watch + overdue) count in the header", () => {
    render(<AgingCard issues={[aged("A", 0, { storyPoints: 5 }), aged("C", 9)]} policy={POLICY} />);
    expect(screen.getByText("1")).toBeTruthy(); // only C is flagged
  });

  // v1.61 (ADR-073, item 174): sprintStartDate clamps the displayed age.
  it("passes sprintStartDate through as the aging clamp", () => {
    // DEV-1 entered its status 9d ago, but the CURRENT sprint only started 3d ago (carried over).
    const sprintStart = new Date(Date.now() - 3 * 86_400_000).toISOString();
    render(
      <AgingCard
        issues={[aged("DEV-1", 9, { storyPoints: 1 })]}
        policy={POLICY}
        sprintStartDate={sprintStart}
      />
    );
    const list = screen.getByRole("list", { name: /ticket aging/i });
    // Clamped to 3d (sprint start), not the raw 9d (inProgressSince).
    expect(list.textContent).toContain("3d in In Progress");
    expect(list.textContent).not.toContain("9d in In Progress");
  });

  it("shows an empty state when nothing has a known age", () => {
    render(<AgingCard issues={[aged("DEV-1", 3, { inProgressSince: null })]} policy={POLICY} />);
    expect(screen.getByText(/nothing in progress yet/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: /ticket aging/i })).toBeNull();
  });

  it("caps the list at 6 and shows a 'Show all N' toggle", () => {
    const many = Array.from({ length: 9 }, (_, i) => aged(`DEV-${i}`, i + 1));
    render(<AgingCard issues={many} policy={POLICY} />);
    const list = screen.getByRole("list", { name: /ticket aging/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    const toggle = screen.getByRole("button", { name: "Show all 9" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands to show all entries and flips to 'Show less'", () => {
    const many = Array.from({ length: 9 }, (_, i) => aged(`DEV-${i}`, i + 1));
    render(<AgingCard issues={many} policy={POLICY} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));

    const list = screen.getByRole("list", { name: /ticket aging/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);
    const toggle = screen.getByRole("button", { name: "Show less" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses back to 6 when 'Show less' is clicked again", () => {
    const many = Array.from({ length: 9 }, (_, i) => aged(`DEV-${i}`, i + 1));
    render(<AgingCard issues={many} policy={POLICY} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    const list = screen.getByRole("list", { name: /ticket aging/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show all 9" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows no expander button at 6 or fewer entries", () => {
    const six = Array.from({ length: 6 }, (_, i) => aged(`DEV-${i}`, i + 1));
    render(<AgingCard issues={six} policy={POLICY} />);
    const list = screen.getByRole("list", { name: /ticket aging/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /show all|show less/i })).toBeNull();
  });

  it("collapses and expands independently (own storage key)", () => {
    render(<AgingCard issues={[aged("DEV-1", 3)]} policy={POLICY} />);
    expect(screen.getByRole("list", { name: /ticket aging/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ticket aging/i }));
    expect(screen.queryByRole("list", { name: /ticket aging/i })).toBeNull();
    expect(localStorage.getItem("loopboard.collapse.aging")).toBeTruthy();
  });

  it("links each row to the ticket in Jira", () => {
    render(<AgingCard issues={[aged("DEV-1", 3)]} policy={POLICY} />);
    const link = screen.getByRole("link", { name: /DEV-1/ });
    expect(link.getAttribute("href")).toBe("https://j/browse/DEV-1");
  });
});

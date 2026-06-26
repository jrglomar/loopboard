// FlyInCard tests — v1.23, ADR-035. Pure matcher + render. Keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FlyInCard, matchFlyIn, selectFlyIns } from "./FlyInCard";
import type { IssueSummary } from "../lib/types";

function issue(over: Partial<IssueSummary>): IssueSummary {
  return {
    key: "VRDB-1", summary: "x", status: "To Do", statusCategory: "todo",
    assignee: null, assigneeAccountId: null, storyPoints: null, issueType: "Task",
    url: "https://jira.example.com/browse/VRDB-1", blocked: false, ...over,
  };
}

afterEach(() => cleanup());

describe("matchFlyIn", () => {
  it("matches fly in / fly-in / flyin (case-insensitive)", () => {
    expect(matchFlyIn("Fly In booking")).toBe(true);
    expect(matchFlyIn("FLY-IN to Manila")).toBe(true);
    expect(matchFlyIn("client flyin trip")).toBe(true);
    expect(matchFlyIn("Arrange FLY  IN logistics".replace(/  /g, " "))).toBe(true);
  });

  it("does not match unrelated words (butterfly inside / family in)", () => {
    expect(matchFlyIn("butterfly inside")).toBe(false);
    expect(matchFlyIn("Family in town")).toBe(false);
    expect(matchFlyIn("Deploy service")).toBe(false);
  });
});

describe("selectFlyIns", () => {
  it("filters a flat issue list to fly-in tickets", () => {
    const list = [
      issue({ key: "VRDB-1", summary: "Fly in: onsite visit" }),
      issue({ key: "VRDB-2", summary: "Build dashboard" }),
      issue({ key: "VRDB-3", summary: "FLYIN approvals" }),
    ];
    expect(selectFlyIns(list).map((i) => i.key)).toEqual(["VRDB-1", "VRDB-3"]);
  });
});

describe("FlyInCard", () => {
  it("shows an empty state when there are no fly-in tickets", () => {
    render(<FlyInCard flyIns={[]} />);
    expect(screen.getByText(/No fly-in tickets this sprint/i)).toBeTruthy();
  });

  it("renders each fly-in ticket as a key link + summary + assignee", () => {
    render(<FlyInCard flyIns={[issue({ key: "VRDB-7", summary: "Fly in: QA onsite", assignee: "Alice" })]} />);
    const link = screen.getByRole("link", { name: /Open VRDB-7 in a new tab/i });
    expect(link.getAttribute("href")).toContain("/browse/VRDB-1"); // fixture url
    expect(screen.getByText("Fly in: QA onsite")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });
});

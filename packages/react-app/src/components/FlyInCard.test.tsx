// FlyInCard tests — v1.23 (ADR-035) + dual PO/Dev alignment v1.27 (ADR-040). Keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FlyInCard, matchFlyIn, selectFlyIns } from "./FlyInCard";
import type { IssueSummary, LinkedIssue } from "../lib/types";

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

describe("FlyInCard (dual PO/Dev, v1.27)", () => {
  it("shows an empty state when neither board has fly-in tickets", () => {
    render(<FlyInCard devFlyIns={[]} poFlyIns={[]} />);
    expect(screen.getByText(/No fly-in tickets this sprint/i)).toBeTruthy();
  });

  it("renders Dev and PO groups with their tickets", () => {
    render(
      <FlyInCard
        devFlyIns={[issue({ key: "VRDB-7", summary: "Fly in: QA onsite", assignee: "Alice" })]}
        poFlyIns={[issue({ key: "VBPO-3", summary: "Fly-in approval", url: "https://jira.example.com/browse/VBPO-3" })]}
      />
    );
    expect(screen.getByText("Dev board")).toBeTruthy();
    expect(screen.getByText("PO board")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open VRDB-7 in a new tab/i })).toBeTruthy();
    expect(screen.getByText("Fly in: QA onsite")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open VBPO-3 in a new tab/i })).toBeTruthy();
  });

  it("flags a PO fly-in as aligned (links to the Dev fly-in) when alignment data has a match", () => {
    const aligned: LinkedIssue = {
      key: "VRDB-9", summary: "Fly in: QA onsite", status: "In Progress",
      url: "https://jira.example.com/browse/VRDB-9",
    };
    render(
      <FlyInCard
        devFlyIns={[]}
        poFlyIns={[issue({ key: "VBPO-3", summary: "Fly-in approval" })]}
        poAlignment={{ "VBPO-3": aligned }}
      />
    );
    const link = screen.getByRole("link", { name: /Aligned with Dev fly-in VRDB-9/i });
    expect(link.getAttribute("href")).toBe("https://jira.example.com/browse/VRDB-9");
  });

  it("flags a PO fly-in with no aligned Dev fly-in", () => {
    render(
      <FlyInCard
        devFlyIns={[]}
        poFlyIns={[issue({ key: "VBPO-3", summary: "Fly-in approval" })]}
        poAlignment={{ "VBPO-3": null }}
      />
    );
    expect(screen.getByText(/No Dev fly-in/i)).toBeTruthy();
  });
});

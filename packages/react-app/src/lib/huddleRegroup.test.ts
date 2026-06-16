import { describe, it, expect } from "vitest";
import {
  deriveInitials,
  regroupByPerson,
  buildByPersonClipboardText,
} from "./huddleRegroup";
import type { GetDailyHuddleOutput } from "./types";

// ── Sample huddle data ────────────────────────────────────────────────────────

const SAMPLE_HUDDLE: GetDailyHuddleOutput = {
  sprintName: "Sprint 7",
  sprintId: 55,
  boardId: 10002,
  generatedAt: new Date("2026-06-12T09:00:00Z").toISOString(),
  summaryText: "Sprint 'Sprint 7' (2026-06-01 – 2026-06-14): 8 issues.",
  inProgress: [
    { key: "DEV-1", summary: "Build login UI",        assignee: "Alice Smith", status: "In Progress" },
    { key: "DEV-2", summary: "Update DB schema",       assignee: "Bob",         status: "In Progress" },
    { key: "DEV-3", summary: "Write unit tests",       assignee: null,          status: "In Progress" },
  ],
  codeReview: [
    { key: "DEV-4", summary: "Review auth PR",         assignee: "Alice Smith", status: "Code Review" },
    { key: "DEV-5", summary: "Review DB migration PR", assignee: "Carol",       status: "Code Review" },
  ],
  blocked: [
    { key: "DEV-6", summary: "Waiting for design",    assignee: "Bob",         status: "In Progress" },
  ],
  done: [
    { key: "DEV-7", summary: "Setup CI",              assignee: "Alice Smith", status: "Done" },
  ],
  upNext: [
    { key: "DEV-8", summary: "Add OAuth",             assignee: null,          status: "To Do" },
  ],
};

// ── deriveInitials ────────────────────────────────────────────────────────────

describe("deriveInitials", () => {
  it("derives two initials from a first+last name", () => {
    expect(deriveInitials("Alice Smith")).toBe("AS");
  });

  it("derives single initial from a single-word name", () => {
    expect(deriveInitials("Bob")).toBe("B");
  });

  it("uses first + last from a multi-word name", () => {
    expect(deriveInitials("Mary Jane Watson")).toBe("MW");
  });

  it("returns ? for null", () => {
    expect(deriveInitials(null)).toBe("?");
  });

  it("returns ? for empty string", () => {
    expect(deriveInitials("")).toBe("?");
  });

  it("uppercases initials", () => {
    expect(deriveInitials("carol jones")).toBe("CJ");
  });
});

// ── regroupByPerson ───────────────────────────────────────────────────────────

describe("regroupByPerson", () => {
  it("produces one group per unique assignee", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    // Alice Smith, Bob, Carol, and null (unassigned)
    const names = groups.map((g) => g.assignee);
    expect(names).toContain("Alice Smith");
    expect(names).toContain("Bob");
    expect(names).toContain("Carol");
    expect(names).toContain(null);
    expect(groups.length).toBe(4);
  });

  it("puts named assignees before unassigned", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const last = groups[groups.length - 1];
    expect(last.assignee).toBeNull();
  });

  it("sorts named assignees alphabetically", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const named = groups.filter((g) => g.assignee !== null).map((g) => g.assignee as string);
    expect(named).toEqual([...named].sort());
  });

  it("assigns Alice's inProgress and codeReview items correctly", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const alice = groups.find((g) => g.assignee === "Alice Smith")!;
    expect(alice.inProgress.map((i) => i.key)).toContain("DEV-1");
    expect(alice.codeReview.map((i) => i.key)).toContain("DEV-4");
    expect(alice.blocked).toHaveLength(0);
  });

  it("assigns Bob's inProgress and blocked items correctly", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const bob = groups.find((g) => g.assignee === "Bob")!;
    expect(bob.inProgress.map((i) => i.key)).toContain("DEV-2");
    expect(bob.blocked.map((i) => i.key)).toContain("DEV-6");
    expect(bob.codeReview).toHaveLength(0);
  });

  it("does NOT include done or upNext items", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const alice = groups.find((g) => g.assignee === "Alice Smith")!;
    const allKeys = [
      ...alice.inProgress,
      ...alice.codeReview,
      ...alice.blocked,
    ].map((i) => i.key);
    // DEV-7 is done — should NOT appear
    expect(allKeys).not.toContain("DEV-7");
  });

  it("groups null assignees together", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const unassigned = groups.find((g) => g.assignee === null)!;
    // DEV-3 is unassigned inProgress
    expect(unassigned.inProgress.map((i) => i.key)).toContain("DEV-3");
  });

  it("derives initials for each group", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const alice = groups.find((g) => g.assignee === "Alice Smith")!;
    expect(alice.initials).toBe("AS");
    const unassigned = groups.find((g) => g.assignee === null)!;
    expect(unassigned.initials).toBe("?");
  });

  it("returns empty array when all buckets are empty", () => {
    const empty: GetDailyHuddleOutput = {
      ...SAMPLE_HUDDLE,
      inProgress: [],
      codeReview: [],
      blocked: [],
    };
    const groups = regroupByPerson(empty);
    expect(groups).toHaveLength(0);
  });
});

// ── buildByPersonClipboardText ────────────────────────────────────────────────

describe("buildByPersonClipboardText", () => {
  it("includes sprint name in header", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const text = buildByPersonClipboardText("Sprint 7", groups);
    expect(text).toContain("Sprint 7");
  });

  it("groups items under assignee names", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const text = buildByPersonClipboardText("Sprint 7", groups);
    expect(text).toContain("Alice Smith");
    expect(text).toContain("Bob");
  });

  it("labels items with their bucket", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const text = buildByPersonClipboardText("Sprint 7", groups);
    expect(text).toContain("[In Progress]");
    expect(text).toContain("[Code Review]");
    expect(text).toContain("[⚠ Blocked]");
  });

  it("includes issue keys in output", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const text = buildByPersonClipboardText("Sprint 7", groups);
    expect(text).toContain("DEV-1");
    expect(text).toContain("DEV-4");
    expect(text).toContain("DEV-6");
  });

  it("labels unassigned section", () => {
    const groups = regroupByPerson(SAMPLE_HUDDLE);
    const text = buildByPersonClipboardText("Sprint 7", groups);
    expect(text).toContain("Unassigned");
  });

  it("shows (no active items) for persons with no active buckets", () => {
    // Carol only has codeReview; give a group with nothing
    const groups = regroupByPerson({
      ...SAMPLE_HUDDLE,
      inProgress: [],
      codeReview: [],
      blocked: [{ key: "DEV-X", summary: "X", assignee: "Solo", status: "blocked" }],
    });
    // Solo has a blocked item, so no "no active items"
    const text = buildByPersonClipboardText("Sprint 7", groups);
    expect(text).toContain("Solo");
    expect(text).toContain("DEV-X");
  });
});

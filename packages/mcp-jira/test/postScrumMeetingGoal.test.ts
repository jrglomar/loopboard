// Post-scrum + meeting-goal store tools — v1.20, ADR-031. Keyless/offline (temp JSON files).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";
import { getPostScrumTool } from "../src/tools/getPostScrum.js";
import { setPostScrumTool } from "../src/tools/setPostScrum.js";
import { getMeetingGoalTool } from "../src/tools/getMeetingGoal.js";
import { setMeetingGoalTool } from "../src/tools/setMeetingGoal.js";

let dir: string;
let psFile: string;
let mgFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-daily-"));
  psFile = path.join(dir, "post-scrum.json");
  mgFile = path.join(dir, "meeting-goal.json");
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_POST_SCRUM_FILE"] = psFile;
  process.env["JIRA_MEETING_GOAL_FILE"] = mgFile;
  resetConfigCache();
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("post-scrum store tools (v1.20)", () => {
  it("get on an empty store returns []", async () => {
    const out = (await getPostScrumTool.handler({ sprintId: 100 })) as { notes: unknown[] };
    expect(out.notes).toEqual([]);
  });

  it("set → get round-trips and fills id + createdAt", async () => {
    const setOut = (await setPostScrumTool.handler({
      sprintId: 100,
      notes: [{ person: "Alice", note: "Follow up on staging access" }],
    })) as { notes: Array<{ id: string; person: string; note: string; createdAt: string }> };
    expect(setOut.notes).toHaveLength(1);
    expect(setOut.notes[0]!.id).toBeTruthy();
    expect(setOut.notes[0]!.createdAt).toBeTruthy();
    expect(setOut.notes[0]!.person).toBe("Alice");

    const getOut = (await getPostScrumTool.handler({ sprintId: 100 })) as { notes: Array<{ note: string }> };
    expect(getOut.notes[0]!.note).toBe("Follow up on staging access");
  });

  it("is per-sprint (sprint 200 unaffected by sprint 100)", async () => {
    await setPostScrumTool.handler({ sprintId: 100, notes: [{ person: "Bob", note: "x" }] });
    const other = (await getPostScrumTool.handler({ sprintId: 200 })) as { notes: unknown[] };
    expect(other.notes).toEqual([]);
  });

  it("rejects a note with no person", async () => {
    await expect(
      setPostScrumTool.handler({ sprintId: 100, notes: [{ note: "x" }] })
    ).rejects.toThrow();
  });

  it("rejects missing sprintId", async () => {
    await expect(setPostScrumTool.handler({ notes: [] })).rejects.toThrow();
  });
});

describe("meeting-goal store tools (v1.20)", () => {
  it("get on an empty store returns empty goal + null updatedAt", async () => {
    const out = (await getMeetingGoalTool.handler({ sprintId: 100 })) as { goal: string; updatedAt: string | null };
    expect(out.goal).toBe("");
    expect(out.updatedAt).toBeNull();
  });

  it("set → get round-trips and stamps updatedAt", async () => {
    const setOut = (await setMeetingGoalTool.handler({
      sprintId: 100,
      goal: "  Unblock the release  ",
    })) as { goal: string; updatedAt: string | null };
    expect(setOut.goal).toBe("Unblock the release"); // trimmed
    expect(setOut.updatedAt).toBeTruthy();

    const getOut = (await getMeetingGoalTool.handler({ sprintId: 100 })) as { goal: string };
    expect(getOut.goal).toBe("Unblock the release");
  });

  it("clears the goal when set to empty/whitespace", async () => {
    await setMeetingGoalTool.handler({ sprintId: 100, goal: "Ship it" });
    const cleared = (await setMeetingGoalTool.handler({ sprintId: 100, goal: "   " })) as { goal: string; updatedAt: string | null };
    expect(cleared.goal).toBe("");
    expect(cleared.updatedAt).toBeNull();
    const getOut = (await getMeetingGoalTool.handler({ sprintId: 100 })) as { goal: string };
    expect(getOut.goal).toBe("");
  });

  it("is per-sprint (sprint 200 unaffected by sprint 100)", async () => {
    await setMeetingGoalTool.handler({ sprintId: 100, goal: "Focus A" });
    const other = (await getMeetingGoalTool.handler({ sprintId: 200 })) as { goal: string };
    expect(other.goal).toBe("");
  });

  it("rejects missing sprintId", async () => {
    await expect(setMeetingGoalTool.handler({ goal: "x" })).rejects.toThrow();
  });
});

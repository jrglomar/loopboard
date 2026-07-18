// get_meeting_notes / set_meeting_notes — v1.41, ADR-051. Keyless/offline (temp store file).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ZodError } from "zod";
import { resetConfigCache } from "../src/lib/config.js";
import { getMeetingNotes } from "../src/tools/getMeetingNotes.js";
import { setMeetingNotes } from "../src/tools/setMeetingNotes.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "invokeboard-notes-"));
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_MEETING_NOTES_FILE"] = path.join(dir, "notes.json");
  resetConfigCache();
});

afterEach(() => {
  delete process.env["JIRA_MEETING_NOTES_FILE"];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("get_meeting_notes / set_meeting_notes (v1.41)", () => {
  it("returns null when nothing was ever saved", async () => {
    const out = (await getMeetingNotes.handler({ sprintId: 7 })) as { sprintId: number; notes: unknown };
    expect(out).toEqual({ sprintId: 7, notes: null });
  });

  it("set → get roundtrip stores the HTML and stamps updatedAt", async () => {
    const html = '<p>Deploy v2 tonight — <a href="https://wiki/deploy">runbook</a></p>';
    const saved = (await setMeetingNotes.handler({ sprintId: 7, html })) as {
      notes: { html: string; updatedAt: string };
    };
    expect(saved.notes.html).toBe(html);
    expect(new Date(saved.notes.updatedAt).getTime()).toBeGreaterThan(0);

    const got = (await getMeetingNotes.handler({ sprintId: 7 })) as {
      notes: { html: string };
    };
    expect(got.notes.html).toBe(html);
    // other sprints are unaffected
    const other = (await getMeetingNotes.handler({ sprintId: 8 })) as { notes: unknown };
    expect(other.notes).toBeNull();
  });

  it("empty/whitespace html clears the entry", async () => {
    await setMeetingNotes.handler({ sprintId: 7, html: "<p>hello</p>" });
    const cleared = (await setMeetingNotes.handler({ sprintId: 7, html: "   " })) as { notes: unknown };
    expect(cleared.notes).toBeNull();
    const got = (await getMeetingNotes.handler({ sprintId: 7 })) as { notes: unknown };
    expect(got.notes).toBeNull();
  });

  it("validates input (missing sprintId / non-string html)", async () => {
    await expect(getMeetingNotes.handler({})).rejects.toThrow(ZodError);
    await expect(setMeetingNotes.handler({ sprintId: 7 })).rejects.toThrow(ZodError);
  });

  it("tolerates a corrupt store file (read returns null, write recovers)", async () => {
    fs.writeFileSync(process.env["JIRA_MEETING_NOTES_FILE"]!, "not json at all");
    const out = (await getMeetingNotes.handler({ sprintId: 7 })) as { notes: unknown };
    expect(out.notes).toBeNull();
    const saved = (await setMeetingNotes.handler({ sprintId: 7, html: "<p>ok</p>" })) as {
      notes: { html: string };
    };
    expect(saved.notes.html).toBe("<p>ok</p>");
  });
});

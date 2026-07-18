// get_retro / set_retro — v1.42, ADR-052. Keyless/offline (temp store file).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ZodError } from "zod";
import { resetConfigCache } from "../src/lib/config.js";
import { getRetro } from "../src/tools/getRetro.js";
import { setRetro } from "../src/tools/setRetro.js";

interface RetroEntry {
  reasonForDelays: string;
  whatWorkedWell: string;
  whatDidNotWork: string;
  plannedImprovements: string;
  kudos: string;
  updatedAt: string;
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "invokeboard-retro-"));
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_RETRO_FILE"] = path.join(dir, "retro.json");
  resetConfigCache();
});

afterEach(() => {
  delete process.env["JIRA_RETRO_FILE"];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("get_retro / set_retro (v1.42)", () => {
  it("returns null when nothing was ever saved", async () => {
    const out = (await getRetro.handler({ sprintId: 7 })) as { sprintId: number; retro: unknown };
    expect(out).toEqual({ sprintId: 7, retro: null });
  });

  it("set → get roundtrip stores the fields (trimmed) and stamps updatedAt", async () => {
    const saved = (await setRetro.handler({
      sprintId: 7,
      reasonForDelays: "  late scope change  ",
      whatWorkedWell: "pairing",
      whatDidNotWork: "flaky CI",
      plannedImprovements: "stabilize CI",
      kudos: "Alice",
    })) as { retro: RetroEntry };
    expect(saved.retro.reasonForDelays).toBe("late scope change"); // trimmed
    expect(saved.retro.whatWorkedWell).toBe("pairing");
    expect(new Date(saved.retro.updatedAt).getTime()).toBeGreaterThan(0);

    const got = (await getRetro.handler({ sprintId: 7 })) as { retro: RetroEntry };
    expect(got.retro.whatDidNotWork).toBe("flaky CI");
    expect(got.retro.plannedImprovements).toBe("stabilize CI");
    expect(got.retro.kudos).toBe("Alice");
    // other sprints are unaffected
    const other = (await getRetro.handler({ sprintId: 8 })) as { retro: unknown };
    expect(other.retro).toBeNull();
  });

  it("partial fields are allowed (unspecified default to empty string)", async () => {
    const saved = (await setRetro.handler({ sprintId: 7, kudos: "the whole team" })) as {
      retro: RetroEntry;
    };
    expect(saved.retro.kudos).toBe("the whole team");
    expect(saved.retro.reasonForDelays).toBe("");
    expect(saved.retro.whatWorkedWell).toBe("");
  });

  it("all-empty (or whitespace-only) fields clear the entry", async () => {
    await setRetro.handler({ sprintId: 7, kudos: "nice" });
    const cleared = (await setRetro.handler({
      sprintId: 7,
      reasonForDelays: "   ",
      kudos: "",
    })) as { retro: unknown };
    expect(cleared.retro).toBeNull();
    const got = (await getRetro.handler({ sprintId: 7 })) as { retro: unknown };
    expect(got.retro).toBeNull();
  });

  it("validates input (missing/invalid sprintId, over-long field)", async () => {
    await expect(getRetro.handler({})).rejects.toThrow(ZodError);
    await expect(setRetro.handler({ sprintId: 0 })).rejects.toThrow(ZodError);
    await expect(setRetro.handler({ sprintId: 7, kudos: "x".repeat(4001) })).rejects.toThrow(ZodError);
  });

  it("tolerates a corrupt store file (read returns null, write recovers)", async () => {
    fs.writeFileSync(process.env["JIRA_RETRO_FILE"]!, "not json at all");
    const out = (await getRetro.handler({ sprintId: 7 })) as { retro: unknown };
    expect(out.retro).toBeNull();
    const saved = (await setRetro.handler({ sprintId: 7, whatWorkedWell: "ok" })) as {
      retro: RetroEntry;
    };
    expect(saved.retro.whatWorkedWell).toBe("ok");
  });
});

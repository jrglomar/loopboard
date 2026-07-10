// Per-user request scoping (v1.45, ADR-055) — AsyncLocalStorage + context-aware getConfig +
// per-user store paths + resolveUserConfig. Keyless/offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getConfig, resetConfigCache, getLeavesFilePath, getRetroFilePath, USER_STORES_DIR,
} from "../src/lib/config.js";
import { runWithUser } from "../src/lib/requestContext.js";
import { resolveUserConfig } from "../src/lib/userConfig.js";
import { createUser, upsertConnection, setGlobalConfig, setUserConfig } from "../src/lib/userStore.js";
import { seal } from "../src/lib/crypto/secretBox.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-rc-"));
  process.env["JIRA_BASE_URL"] = "https://global.atlassian.net";
  process.env["JIRA_EMAIL"] = "global@example.com";
  process.env["JIRA_API_TOKEN"] = "global-token";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["TOKEN_ENC_KEY"] = Buffer.alloc(32, 5).toString("base64");
  process.env["SESSION_SECRET"] = "rc-secret";
  process.env["TASK_HELPER_FILE"] = path.join(dir, "users.json");
  resetConfigCache();
});

afterEach(() => {
  delete process.env["TASK_HELPER_FILE"];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("request context (ADR-055)", () => {
  it("getConfig() returns the global .env config outside any user context", () => {
    expect(getConfig().JIRA_API_TOKEN).toBe("global-token");
    expect(getConfig().JIRA_BASE_URL).toBe("https://global.atlassian.net");
  });

  it("getConfig() returns the per-user config inside runWithUser", () => {
    const userCfg = { ...getConfig(), JIRA_API_TOKEN: "user-A-token", JIRA_BASE_URL: "https://a.atlassian.net" };
    runWithUser({ userId: "userA", config: userCfg }, () => {
      expect(getConfig().JIRA_API_TOKEN).toBe("user-A-token");
      expect(getConfig().JIRA_BASE_URL).toBe("https://a.atlassian.net");
    });
    // and reverts outside the context
    expect(getConfig().JIRA_API_TOKEN).toBe("global-token");
  });

  it("store paths are namespaced per user inside a context, shared outside", () => {
    expect(getLeavesFilePath()).toContain(".loopboard-leaves.json"); // shared default
    runWithUser({ userId: "userB", config: getConfig() }, () => {
      const p = getLeavesFilePath();
      expect(p.startsWith(USER_STORES_DIR)).toBe(true);
      expect(p).toContain(path.join("userB", "leaves.json"));
      // a different store for the same user lands in the same dir
      expect(getRetroFilePath()).toContain(path.join("userB", "retro.json"));
    });
  });

  it("two users get isolated store paths (no board-id collisions)", () => {
    let a = "", b = "";
    runWithUser({ userId: "u1", config: getConfig() }, () => { a = getLeavesFilePath(); });
    runWithUser({ userId: "u2", config: getConfig() }, () => { b = getLeavesFilePath(); });
    expect(a).not.toBe(b);
    expect(a).toContain("u1");
    expect(b).toContain("u2");
  });

  it("resolveUserConfig builds a Config from the user's own Jira connection", () => {
    const user = createUser("alice@team.com", "hash");
    upsertConnection(user.id, "jira", {
      enc: seal("alice-jira-token"),
      meta: { baseUrl: "https://alice.atlassian.net", email: "alice@team.com", hint: "…oken" },
      updatedAt: new Date().toISOString(),
    });
    const cfg = resolveUserConfig(user.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.JIRA_API_TOKEN).toBe("alice-jira-token"); // decrypted, per-user
    expect(cfg!.JIRA_BASE_URL).toBe("https://alice.atlassian.net");
    expect(cfg!.JIRA_EMAIL).toBe("alice@team.com");
    // inherits global tuning defaults
    expect(cfg!.JIRA_DEV_BOARD_ID).toBe("10002");
  });

  it("resolveUserConfig returns null when the user has no Jira connection", () => {
    const user = createUser("nobody@team.com", "hash");
    expect(resolveUserConfig(user.id)).toBeNull();
  });

  it("resolveUserConfig merges admin global defaults ← per-user overrides ← the user's Jira creds (Phase B)", () => {
    const user = createUser("bob@team.com", "hash");
    upsertConnection(user.id, "jira", {
      enc: seal("bob-jira-token"),
      meta: { baseUrl: "https://bob.atlassian.net", email: "bob@team.com", hint: "…oken" },
      updatedAt: new Date().toISOString(),
    });
    // Admin sets a global board id for everyone, then a per-user PO-board override for Bob.
    setGlobalConfig({ JIRA_DEV_BOARD_ID: "9001", JIRA_PO_BOARD_ID: "9000", JIRA_VELOCITY_SPRINTS: 3 });
    setUserConfig(user.id, { JIRA_PO_BOARD_ID: "9999", JIRA_LINK_TYPE: "Blocks" });

    const cfg = resolveUserConfig(user.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.JIRA_DEV_BOARD_ID).toBe("9001"); // from admin global default
    expect(cfg!.JIRA_PO_BOARD_ID).toBe("9999"); // per-user override wins over global
    expect(cfg!.JIRA_VELOCITY_SPRINTS).toBe(3); // numeric field coerced + applied
    expect(cfg!.JIRA_LINK_TYPE).toBe("Blocks"); // per-user override
    // the user's own connection still wins for base/email/token
    expect(cfg!.JIRA_API_TOKEN).toBe("bob-jira-token");
    expect(cfg!.JIRA_BASE_URL).toBe("https://bob.atlassian.net");
  });
});

// Shared credentials / delegation (v1.46, ADR-056) — a user with NO tokens borrows a source
// user's Jira/GitHub/AI, shares their local stores + config, and is read-only against Jira
// unless an admin grants writes. Keyless/offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache, getLeavesFilePath, USER_STORES_DIR } from "../src/lib/config.js";
import { runWithUser } from "../src/lib/requestContext.js";
import { resolveUser } from "../src/lib/userConfig.js";
import { getEffectiveConnection, canUserWriteJira, isDelegated } from "../src/lib/delegation.js";
import { createUser, updateUser, upsertConnection, setUserConfig, findUserById } from "../src/lib/userStore.js";
import { seal } from "../src/lib/crypto/secretBox.js";

let dir: string;
let ownerId: string;
let viewerId: string;

function connectJira(userId: string, token: string, baseUrl: string, email: string) {
  upsertConnection(userId, "jira", {
    enc: seal(token),
    meta: { baseUrl, email, hint: "…xxxx" },
    updatedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-deleg-"));
  process.env["JIRA_BASE_URL"] = "https://global.atlassian.net";
  process.env["JIRA_EMAIL"] = "global@example.com";
  process.env["JIRA_API_TOKEN"] = "global-token";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["TOKEN_ENC_KEY"] = Buffer.alloc(32, 3).toString("base64");
  process.env["SESSION_SECRET"] = "deleg-secret";
  process.env["TASK_HELPER_FILE"] = path.join(dir, "users.json");
  resetConfigCache();

  // The credential OWNER has a real Jira connection; the VIEWER has none and borrows it.
  const owner = createUser("owner@team.com", "hash", "admin");
  ownerId = owner.id;
  connectJira(ownerId, "owner-jira-token", "https://owner.atlassian.net", "owner@team.com");

  const viewer = createUser("viewer@team.com", "hash", "user", { credentialSourceUserId: ownerId });
  viewerId = viewer.id;
});

afterEach(() => {
  delete process.env["TASK_HELPER_FILE"];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("shared credentials (ADR-056)", () => {
  it("a viewer with no tokens borrows the owner's Jira connection", () => {
    const eff = getEffectiveConnection(viewerId, "jira");
    expect(eff).not.toBeNull();
    expect(eff!.viaUserId).toBe(ownerId); // borrowed
    // the owner's own connection is NOT borrowed
    expect(getEffectiveConnection(ownerId, "jira")!.viaUserId).toBeNull();
  });

  it("resolveUser gives the viewer the owner's Jira token and store directory", () => {
    const r = resolveUser(viewerId);
    expect(r).not.toBeNull();
    expect(r!.config.JIRA_API_TOKEN).toBe("owner-jira-token"); // decrypted, borrowed
    expect(r!.config.JIRA_BASE_URL).toBe("https://owner.atlassian.net");
    expect(r!.sharedFromUserId).toBe(ownerId);
    expect(r!.storeUserId).toBe(ownerId); // shares the owner's local team stores
  });

  it("the viewer's per-user store paths point at the OWNER's directory", () => {
    const r = resolveUser(viewerId)!;
    runWithUser({ userId: viewerId, config: r.config, storeUserId: r.storeUserId }, () => {
      const p = getLeavesFilePath();
      expect(p.startsWith(USER_STORES_DIR)).toBe(true);
      expect(p).toContain(path.join(ownerId, "leaves.json")); // NOT viewerId
    });
  });

  it("the viewer inherits the owner's board overrides; their own overrides win", () => {
    setUserConfig(ownerId, { JIRA_PO_BOARD_ID: "777", JIRA_LINK_TYPE: "Blocks" });
    expect(resolveUser(viewerId)!.config.JIRA_PO_BOARD_ID).toBe("777");
    expect(resolveUser(viewerId)!.config.JIRA_LINK_TYPE).toBe("Blocks");

    setUserConfig(viewerId, { JIRA_PO_BOARD_ID: "888" });
    expect(resolveUser(viewerId)!.config.JIRA_PO_BOARD_ID).toBe("888"); // own override wins
    expect(resolveUser(viewerId)!.config.JIRA_LINK_TYPE).toBe("Blocks"); // still inherited
  });

  it("a borrower is read-only against Jira until an admin grants writes", () => {
    expect(resolveUser(viewerId)!.canWriteJira).toBe(false);
    updateUser(viewerId, { allowWrites: true });
    expect(resolveUser(viewerId)!.canWriteJira).toBe(true);
  });

  it("a user on their OWN token can always write", () => {
    const owner = findUserById(ownerId)!;
    expect(isDelegated(owner)).toBe(false);
    expect(canUserWriteJira(owner, getEffectiveConnection(ownerId, "jira"))).toBe(true);
    expect(resolveUser(ownerId)!.canWriteJira).toBe(true);
    expect(resolveUser(ownerId)!.storeUserId).toBe(ownerId);
  });

  it("a viewer's OWN connection takes precedence over the borrowed one", () => {
    connectJira(viewerId, "viewer-own-token", "https://viewer.atlassian.net", "viewer@team.com");
    const r = resolveUser(viewerId)!;
    expect(r.config.JIRA_API_TOKEN).toBe("viewer-own-token");
    expect(r.sharedFromUserId).toBeNull();
    expect(r.storeUserId).toBe(viewerId); // back to their own stores
    expect(r.canWriteJira).toBe(true); // acting as themselves
  });

  it("resolveUser returns null for a disabled account", () => {
    updateUser(viewerId, { disabled: true });
    expect(resolveUser(viewerId)).toBeNull();
  });

  it("resolveUser returns null when there is nothing to borrow", () => {
    const orphan = createUser("orphan@team.com", "hash");
    expect(resolveUser(orphan.id)).toBeNull();
  });
});

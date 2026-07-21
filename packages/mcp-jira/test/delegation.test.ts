// Shared credentials / delegation (v1.46, ADR-056) — a user with NO tokens borrows a source
// user's Jira/GitHub/AI, shares their local stores + config, and is read-only against Jira
// unless an admin grants writes. Keyless/offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache, getLeavesFilePath, getProjects, USER_STORES_DIR } from "../src/lib/config.js";
import { runWithUser } from "../src/lib/requestContext.js";
import { resolveUser } from "../src/lib/userConfig.js";
import { getEffectiveConnection, canUserWriteJira, isDelegated } from "../src/lib/delegation.js";
import { createUser, updateUser, upsertConnection, setUserConfig, findUserById, getConnection } from "../src/lib/userStore.js";
import { seal } from "../src/lib/crypto/secretBox.js";
import { getAiStatus } from "../src/lib/ai/provider.js";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "invokeboard-deleg-"));
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

// v1.67 (ADR-078) — granular per-provider sharing. `sharedProviders` restricts WHICH providers a
// borrower may fall back to; undefined (the legacy default) shares everything, unchanged.
describe("granular per-provider sharing (v1.67, ADR-078)", () => {
  beforeEach(() => {
    // The owner also has GitHub + AI connections to share, on top of the Jira set up in the outer
    // beforeEach — so restriction tests can prove a listed provider still resolves and an unlisted
    // one does not, for the SAME owner/viewer pair.
    upsertConnection(ownerId, "github", {
      enc: seal("owner-gh-token"),
      meta: { login: "owner", hint: "…gh" },
      updatedAt: new Date().toISOString(),
    });
    upsertConnection(ownerId, "ai", {
      enc: seal("owner-ai-token"),
      meta: { provider: "github", model: "openai/gpt-4o-mini", hint: "…ai" },
      updatedAt: new Date().toISOString(),
    });
  });

  it("undefined sharedProviders (the default/legacy) shares ALL providers the viewer doesn't own", () => {
    expect(getEffectiveConnection(viewerId, "jira")!.viaUserId).toBe(ownerId);
    expect(getEffectiveConnection(viewerId, "github")!.viaUserId).toBe(ownerId);
    expect(getEffectiveConnection(viewerId, "ai")!.viaUserId).toBe(ownerId);
  });

  it("an explicit sharedProviders list restricts fallback to only the listed providers", () => {
    updateUser(viewerId, { sharedProviders: ["github"] });
    expect(getEffectiveConnection(viewerId, "github")!.viaUserId).toBe(ownerId); // shared
    expect(getEffectiveConnection(viewerId, "jira")).toBeNull(); // NOT shared — shows disconnected
    expect(getEffectiveConnection(viewerId, "ai")).toBeNull(); // NOT shared
  });

  it("a provider absent from the list returns null even though the source HAS that connection", () => {
    updateUser(viewerId, { sharedProviders: ["jira"] });
    // The owner genuinely has an AI connection — but it's not on the list, so no fallback.
    expect(getConnection(ownerId, "ai")).not.toBeNull();
    expect(getEffectiveConnection(viewerId, "ai")).toBeNull();
    expect(getEffectiveConnection(viewerId, "jira")!.viaUserId).toBe(ownerId); // listed → still shared
  });

  it("setting sharedProviders to null clears the restriction back to share-all", () => {
    updateUser(viewerId, { sharedProviders: ["jira"] });
    expect(getEffectiveConnection(viewerId, "github")).toBeNull();

    updateUser(viewerId, { sharedProviders: null });
    expect(getEffectiveConnection(viewerId, "github")!.viaUserId).toBe(ownerId); // restored
  });

  it("a restricted provider still resolves to the viewer's OWN connection if they have one", () => {
    updateUser(viewerId, { sharedProviders: ["jira"] }); // github excluded from sharing
    connectJira(viewerId, "irrelevant", "https://x", "x@y.com"); // not used by this assertion
    upsertConnection(viewerId, "github", {
      enc: seal("viewer-own-gh"),
      meta: { login: "viewer", hint: "…v" },
      updatedAt: new Date().toISOString(),
    });
    const eff = getEffectiveConnection(viewerId, "github")!;
    expect(eff.viaUserId).toBeNull(); // own connection wins regardless of sharedProviders
  });
});

// v1.51 (ADR-062) — a per-user board override must survive all the way to getProjects(), which is
// what GET /api/me/context runs inside runWithUser() to tell the UI which board to show. Reproduces
// the reported bug: a shared-connection viewer set a different Dev board but still saw the .env board.
describe("per-user board override reaches getProjects() (the /api/me/context path)", () => {
  it("globally (no request context) getProjects() uses the .env board ids", () => {
    expect(getProjects().dev[0]).toEqual({ id: 10002, projectKey: "DEV" });
    expect(getProjects().po[0]).toEqual({ id: 10001, projectKey: "PO" });
  });

  it("a viewer's Dev board ID override changes the board getProjects() resolves IN their context", () => {
    // The admin points this borrower at a different Dev board — the id is what selects the board.
    setUserConfig(viewerId, { JIRA_DEV_BOARD_ID: "9999", JIRA_DEV_PROJECT_KEY: "OTHER" });
    const r = resolveUser(viewerId)!;
    expect(r.config.JIRA_DEV_BOARD_ID).toBe("9999"); // resolved config carries the override

    const boards = runWithUser(
      { userId: viewerId, config: r.config, storeUserId: r.storeUserId },
      () => getProjects()
    );
    expect(boards.dev[0]).toEqual({ id: 9999, projectKey: "OTHER" }); // the OVERRIDDEN board, not 10002
    expect(boards.po[0]).toEqual({ id: 10001, projectKey: "PO" }); // untouched side stays global
  });

  it("overriding only the project KEY (not the board ID) does NOT change which board is fetched", () => {
    // The reported trap: getProjects() selects by board *id*; a key-only override is cosmetic.
    setUserConfig(viewerId, { JIRA_DEV_PROJECT_KEY: "RELABEL" });
    const r = resolveUser(viewerId)!;
    const boards = runWithUser(
      { userId: viewerId, config: r.config, storeUserId: r.storeUserId },
      () => getProjects()
    );
    expect(boards.dev[0]).toEqual({ id: 10002, projectKey: "RELABEL" }); // same id 10002 → same board
  });
});

// v1.53 (ADR-064) — a user's OWN AI token must make getAiStatus() report enabled inside their context,
// which is what GET /api/me/context runs to tell the UI whether the assistant/drafting is available.
// Reproduces the reported bug: global .env has no AI, but a user on their own AI token saw "AI disabled".
describe("per-user AI status reaches getAiStatus() (the /api/me/context .ai path)", () => {
  it("globally (no .env AI, no request context) getAiStatus() reports disabled", () => {
    expect(getAiStatus()).toEqual({ enabled: false, provider: null, model: null });
  });

  it("a user on their OWN AI token is reported ENABLED in their context, though global AI is off", () => {
    upsertConnection(viewerId, "ai", {
      enc: seal("viewer-ai-token"),
      meta: { provider: "github", model: "openai/gpt-4o-mini", hint: "…xxxx" },
      updatedAt: new Date().toISOString(),
    });
    const r = resolveUser(viewerId)!;
    const ai = runWithUser(
      { userId: viewerId, config: r.config, storeUserId: r.storeUserId },
      () => getAiStatus()
    );
    expect(ai).toEqual({ enabled: true, provider: "github", model: "openai/gpt-4o-mini" });
    expect(getAiStatus().enabled).toBe(false); // still disabled globally — the exact bug scenario
  });
});

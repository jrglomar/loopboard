import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetConfigCache } from "../src/lib/config.js";

describe("getConfig", () => {
  beforeEach(() => {
    resetConfigCache();
    // Ensure required vars are not set from environment
    delete process.env["GITHUB_TOKEN"];
    delete process.env["JIRA_BASE_URL"];
    delete process.env["JIRA_EMAIL"];
    delete process.env["JIRA_API_TOKEN"];
    delete process.env["GITHUB_REPO"];
    delete process.env["JIRA_PO_PROJECT_KEY"];
    delete process.env["JIRA_DEV_PROJECT_KEY"];
    delete process.env["MCP_GITHUB_HTTP_PORT"];
  });

  afterEach(() => {
    resetConfigCache();
    vi.restoreAllMocks();
  });

  it("throws ConfigError listing missing required vars", async () => {
    const { getConfig } = await import("../src/lib/config.js");
    expect(() => getConfig()).toThrow(/GITHUB_TOKEN/);
  });

  it("throws ConfigError mentioning all missing required vars", async () => {
    const { getConfig } = await import("../src/lib/config.js");
    let message = "";
    try {
      getConfig();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("GITHUB_TOKEN");
    expect(message).toContain("JIRA_BASE_URL");
    expect(message).toContain("JIRA_EMAIL");
    expect(message).toContain("JIRA_API_TOKEN");
  });

  it("succeeds with all required vars set and applies defaults", async () => {
    process.env["GITHUB_TOKEN"] = "gh_test_token";
    process.env["JIRA_BASE_URL"] = "https://acme.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "jira_token";

    const { getConfig } = await import("../src/lib/config.js");
    const cfg = getConfig();

    expect(cfg.GITHUB_TOKEN).toBe("gh_test_token");
    expect(cfg.JIRA_BASE_URL).toBe("https://acme.atlassian.net");
    expect(cfg.JIRA_PO_PROJECT_KEY).toBe("PO");
    expect(cfg.JIRA_DEV_PROJECT_KEY).toBe("DEV");
    expect(cfg.MCP_GITHUB_HTTP_PORT).toBe(4002);
    expect(cfg.GITHUB_REPO).toBeUndefined();
  });

  it("respects custom optional vars when set", async () => {
    process.env["GITHUB_TOKEN"] = "tok";
    process.env["JIRA_BASE_URL"] = "https://x.atlassian.net";
    process.env["JIRA_EMAIL"] = "a@b.com";
    process.env["JIRA_API_TOKEN"] = "api_tok";
    process.env["GITHUB_REPO"] = "org/myrepo";
    process.env["JIRA_PO_PROJECT_KEY"] = "MYPO";
    process.env["JIRA_DEV_PROJECT_KEY"] = "MYDEV";
    process.env["MCP_GITHUB_HTTP_PORT"] = "9000";

    const { getConfig } = await import("../src/lib/config.js");
    const cfg = getConfig();

    expect(cfg.GITHUB_REPO).toBe("org/myrepo");
    expect(cfg.JIRA_PO_PROJECT_KEY).toBe("MYPO");
    expect(cfg.JIRA_DEV_PROJECT_KEY).toBe("MYDEV");
    expect(cfg.MCP_GITHUB_HTTP_PORT).toBe(9000);
  });

  it("caches the config after first call", async () => {
    process.env["GITHUB_TOKEN"] = "tok2";
    process.env["JIRA_BASE_URL"] = "https://x.atlassian.net";
    process.env["JIRA_EMAIL"] = "a@b.com";
    process.env["JIRA_API_TOKEN"] = "api_tok2";

    const { getConfig } = await import("../src/lib/config.js");
    const first = getConfig();
    const second = getConfig();
    expect(first).toBe(second);
  });

  it("resetConfigCache clears cache so next call re-reads env", async () => {
    process.env["GITHUB_TOKEN"] = "tok3";
    process.env["JIRA_BASE_URL"] = "https://x.atlassian.net";
    process.env["JIRA_EMAIL"] = "a@b.com";
    process.env["JIRA_API_TOKEN"] = "api_tok3";

    const { getConfig: getConfigFresh, resetConfigCache: reset } = await import(
      "../src/lib/config.js"
    );
    const first = getConfigFresh();
    reset();
    process.env["GITHUB_TOKEN"] = "tok3_new";
    const second = getConfigFresh();
    expect(second.GITHUB_TOKEN).toBe("tok3_new");
    expect(first).not.toBe(second);
  });
});

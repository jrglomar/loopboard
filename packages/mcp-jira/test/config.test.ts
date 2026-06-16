import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfigCache } from "../src/lib/config.js";
import { ConfigError } from "../src/lib/errors.js";

// Save and restore process.env around each test
const originalEnv = { ...process.env };

beforeEach(() => {
  resetConfigCache();
  // Clear all Jira-related env vars
  delete process.env["JIRA_BASE_URL"];
  delete process.env["JIRA_EMAIL"];
  delete process.env["JIRA_API_TOKEN"];
  delete process.env["JIRA_PO_PROJECT_KEY"];
  delete process.env["JIRA_DEV_PROJECT_KEY"];
  delete process.env["JIRA_PO_BOARD_ID"];
  delete process.env["JIRA_DEV_BOARD_ID"];
  delete process.env["JIRA_STORY_POINTS_FIELD"];
  delete process.env["JIRA_LINK_TYPE"];
  delete process.env["JIRA_FLAGGED_FIELD"];
  delete process.env["MCP_JIRA_HTTP_PORT"];
});

afterEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  resetConfigCache();
});

function setRequiredVars() {
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "test@example.com";
  process.env["JIRA_API_TOKEN"] = "test-token";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
}

describe("getConfig", () => {
  it("throws ConfigError listing missing required vars", () => {
    // All required vars missing
    let error: unknown;
    try {
      getConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const cfg = error as ConfigError;
    expect(cfg.missingVars).toContain("JIRA_BASE_URL");
    expect(cfg.missingVars).toContain("JIRA_EMAIL");
    expect(cfg.missingVars).toContain("JIRA_API_TOKEN");
  });

  it("names the specific missing vars in the error message", () => {
    process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    // JIRA_API_TOKEN still missing + board IDs missing
    let error: unknown;
    try {
      getConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const msg = (error as ConfigError).message;
    expect(msg).toContain("JIRA_API_TOKEN");
  });

  it("succeeds when all required vars are set", () => {
    setRequiredVars();
    const cfg = getConfig();
    expect(cfg.JIRA_BASE_URL).toBe("https://test.atlassian.net");
    expect(cfg.JIRA_EMAIL).toBe("test@example.com");
  });

  it("applies defaults for optional vars", () => {
    setRequiredVars();
    const cfg = getConfig();
    expect(cfg.JIRA_PO_PROJECT_KEY).toBe("PO");
    expect(cfg.JIRA_DEV_PROJECT_KEY).toBe("DEV");
    expect(cfg.JIRA_STORY_POINTS_FIELD).toBe("customfield_10016");
    expect(cfg.JIRA_LINK_TYPE).toBe("Relates");
    expect(cfg.JIRA_FLAGGED_FIELD).toBe("");
    expect(cfg.MCP_JIRA_HTTP_PORT).toBe(4001);
  });

  it("respects overridden optional vars", () => {
    setRequiredVars();
    process.env["JIRA_PO_PROJECT_KEY"] = "MYPO";
    process.env["MCP_JIRA_HTTP_PORT"] = "9999";
    const cfg = getConfig();
    expect(cfg.JIRA_PO_PROJECT_KEY).toBe("MYPO");
    expect(cfg.MCP_JIRA_HTTP_PORT).toBe(9999);
  });

  it("caches the config after first call", () => {
    setRequiredVars();
    const cfg1 = getConfig();
    // Change env after first call — should not affect cached result
    process.env["JIRA_BASE_URL"] = "https://changed.atlassian.net";
    const cfg2 = getConfig();
    expect(cfg1).toBe(cfg2); // same object reference
    expect(cfg2.JIRA_BASE_URL).toBe("https://test.atlassian.net");
  });

  it("resetConfigCache() allows re-reading env", () => {
    setRequiredVars();
    getConfig();
    resetConfigCache();
    process.env["JIRA_BASE_URL"] = "https://new.atlassian.net";
    const cfg = getConfig();
    expect(cfg.JIRA_BASE_URL).toBe("https://new.atlassian.net");
  });
});

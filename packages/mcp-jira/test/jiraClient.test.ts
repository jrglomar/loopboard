/**
 * Unit tests for jiraClient helpers that can be tested without network.
 * The isBlocked function and mapIssue-level blocked detection are tested here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isBlocked } from "../src/lib/jiraClient.js";
import { resetConfigCache } from "../src/lib/config.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  resetConfigCache();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  resetConfigCache();
});

function makeFields(overrides: {
  statusName?: string;
  labels?: string[];
  flaggedValue?: unknown;
  flaggedField?: string;
}): Parameters<typeof isBlocked>[0] {
  return {
    summary: "Test issue",
    status: {
      name: overrides.statusName ?? "In Progress",
      statusCategory: { key: "indeterminate" },
    },
    assignee: null,
    issuetype: { name: "Task" },
    labels: overrides.labels ?? [],
    description: null,
    reporter: null,
    created: "2026-01-01T00:00:00.000+0000",
    updated: "2026-01-01T00:00:00.000+0000",
    ...(overrides.flaggedField !== undefined
      ? { [overrides.flaggedField]: overrides.flaggedValue }
      : {}),
  };
}

describe("isBlocked", () => {
  describe("label-based blocking", () => {
    it("returns true when labels include 'blocked' (lowercase)", () => {
      const fields = makeFields({ labels: ["blocked"] });
      expect(isBlocked(fields, "")).toBe(true);
    });

    it("returns true when labels include 'Blocked' (uppercase)", () => {
      const fields = makeFields({ labels: ["Blocked"] });
      expect(isBlocked(fields, "")).toBe(true);
    });

    it("returns true when labels include 'BLOCKED' (all caps)", () => {
      const fields = makeFields({ labels: ["BLOCKED"] });
      expect(isBlocked(fields, "")).toBe(true);
    });

    it("returns false when labels do not include 'blocked'", () => {
      const fields = makeFields({ labels: ["urgent", "backend"] });
      expect(isBlocked(fields, "")).toBe(false);
    });

    it("returns false when labels array is empty", () => {
      const fields = makeFields({ labels: [] });
      expect(isBlocked(fields, "")).toBe(false);
    });
  });

  describe("status-based blocking", () => {
    it("returns true when status name is 'Blocked'", () => {
      const fields = makeFields({ statusName: "Blocked" });
      expect(isBlocked(fields, "")).toBe(true);
    });

    it("returns true when status name contains 'block' (case-insensitive substring)", () => {
      const fields = makeFields({ statusName: "Blocked by dependency" });
      expect(isBlocked(fields, "")).toBe(true);
    });

    it("returns false when status name is 'In Progress'", () => {
      const fields = makeFields({ statusName: "In Progress" });
      expect(isBlocked(fields, "")).toBe(false);
    });
  });

  describe("flagged field blocking", () => {
    it("returns true when flaggedField is set and value is truthy", () => {
      const fields = makeFields({
        flaggedField: "customfield_10XXX",
        flaggedValue: "impediment",
      });
      expect(isBlocked(fields, "customfield_10XXX")).toBe(true);
    });

    it("returns true when flaggedField value is a non-empty object", () => {
      const fields = makeFields({
        flaggedField: "flagField",
        flaggedValue: { name: "Impediment" },
      });
      expect(isBlocked(fields, "flagField")).toBe(true);
    });

    it("returns false when flaggedField is empty string (disabled)", () => {
      const fields = makeFields({
        flaggedField: "someField",
        flaggedValue: "impediment",
      });
      // flaggedField="" means disabled
      expect(isBlocked(fields, "")).toBe(false);
    });

    it("returns false when flaggedField is set but value is null", () => {
      const fields = makeFields({
        flaggedField: "flagField",
        flaggedValue: null,
      });
      expect(isBlocked(fields, "flagField")).toBe(false);
    });

    it("returns false when flaggedField is set but value is false", () => {
      const fields = makeFields({
        flaggedField: "flagField",
        flaggedValue: false,
      });
      expect(isBlocked(fields, "flagField")).toBe(false);
    });

    it("returns false when flaggedField is set but value is empty string", () => {
      const fields = makeFields({
        flaggedField: "flagField",
        flaggedValue: "",
      });
      expect(isBlocked(fields, "flagField")).toBe(false);
    });
  });

  describe("not blocked", () => {
    it("returns false for a normal in-progress issue", () => {
      const fields = makeFields({ statusName: "In Progress", labels: [] });
      expect(isBlocked(fields, "")).toBe(false);
    });

    it("returns false for a todo issue with no flags", () => {
      const fields = makeFields({ statusName: "To Do", labels: [] });
      expect(isBlocked(fields, "")).toBe(false);
    });
  });
});

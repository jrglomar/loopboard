import { describe, it, expect } from "vitest";
import { detectJiraKeys } from "../src/lib/jiraKeys.js";

describe("detectJiraKeys", () => {
  it("detects keys from title", () => {
    const keys = detectJiraKeys({
      title: "Fix DEV-123 issue",
      branch: "main",
      body: null,
    });
    expect(keys).toEqual(["DEV-123"]);
  });

  it("detects keys from branch name", () => {
    const keys = detectJiraKeys({
      title: "chore: cleanup",
      branch: "feature/DEV-456-login",
      body: null,
    });
    expect(keys).toEqual(["DEV-456"]);
  });

  it("detects keys from body", () => {
    const keys = detectJiraKeys({
      title: "some PR",
      branch: "main",
      body: "Closes PO-78 and DEV-99",
    });
    expect(keys).toEqual(["PO-78", "DEV-99"]);
  });

  it("treats null body as empty string (no TypeError)", () => {
    expect(() =>
      detectJiraKeys({ title: "x", branch: "y", body: null }),
    ).not.toThrow();
  });

  it("dedupes and preserves first-seen order", () => {
    const keys = detectJiraKeys({
      title: "DEV-10 and DEV-10",
      branch: "DEV-10",
      body: "DEV-11 DEV-10 DEV-12",
    });
    expect(keys).toEqual(["DEV-10", "DEV-11", "DEV-12"]);
  });

  it("returns empty when no keys found", () => {
    const keys = detectJiraKeys({
      title: "no jira key here",
      branch: "main",
      body: "some description",
    });
    expect(keys).toEqual([]);
  });

  it("applies prefix filter — keeps matching prefixes", () => {
    const keys = detectJiraKeys({
      title: "PO-1 DEV-2 OTHER-3",
      branch: "main",
      body: null,
      prefixFilter: ["PO", "DEV"],
    });
    expect(keys).toEqual(["PO-1", "DEV-2"]);
  });

  it("applies prefix filter — rejects non-matching prefix", () => {
    const keys = detectJiraKeys({
      title: "OTHER-3",
      branch: "main",
      body: null,
      prefixFilter: ["PO", "DEV"],
    });
    expect(keys).toEqual([]);
  });

  it("no prefix filter — keeps all detected keys", () => {
    const keys = detectJiraKeys({
      title: "FOO-1 BAR-2",
      branch: "main",
      body: null,
      prefixFilter: [],
    });
    expect(keys).toEqual(["FOO-1", "BAR-2"]);
  });

  it("detects keys across all three sources combined", () => {
    const keys = detectJiraKeys({
      title: "PO-1",
      branch: "feature/DEV-2-stuff",
      body: "Closes DEV-3",
    });
    expect(keys).toEqual(["PO-1", "DEV-2", "DEV-3"]);
  });

  it("rejects lowercase keys (regex is case-sensitive)", () => {
    const keys = detectJiraKeys({
      title: "dev-123",
      branch: "main",
      body: null,
    });
    expect(keys).toEqual([]);
  });

  it("rejects keys where prefix is more than 10 chars", () => {
    const keys = detectJiraKeys({
      title: "TOOLONGPREFIX-1",
      branch: "main",
      body: null,
    });
    expect(keys).toEqual([]);
  });
});

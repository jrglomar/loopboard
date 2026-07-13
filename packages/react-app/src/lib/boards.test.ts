// boards.ts unit tests — the pure boards normalizer (ADR-017; v1.51 ADR-062).
// v1.51: boards come from the per-user context (AuthContext / GET /api/me/context), not
// /api/health. The normalize logic is unchanged and lives in `normalizeBoards`.

import { describe, it, expect } from "vitest";
import { normalizeBoards } from "./boards";

describe("normalizeBoards", () => {
  it("keeps valid per-side arrays (v1.25 multi-project)", () => {
    expect(
      normalizeBoards({
        dev: [{ id: 10, projectKey: "DEV" }, { id: 11, projectKey: "DEV2" }],
        po: [{ id: 20, projectKey: "PO" }],
      })
    ).toEqual({
      dev: [{ id: 10, projectKey: "DEV" }, { id: 11, projectKey: "DEV2" }],
      po: [{ id: 20, projectKey: "PO" }],
    });
  });

  it("normalizes a legacy object-shaped side into a 1-element array", () => {
    expect(
      normalizeBoards({ dev: { id: 10, projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } })
    ).toEqual({ dev: [{ id: 10, projectKey: "DEV" }], po: [{ id: 20, projectKey: "PO" }] });
  });

  it("returns null when a side is missing", () => {
    expect(normalizeBoards({ dev: { id: 10, projectKey: "DEV" } })).toBeNull();
  });

  it("returns null when a side is an empty array", () => {
    expect(normalizeBoards({ dev: [], po: [{ id: 20, projectKey: "PO" }] })).toBeNull();
  });

  it("returns null when an id is not a number", () => {
    expect(
      normalizeBoards({ dev: { id: "nope", projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } })
    ).toBeNull();
  });

  it("returns null for a non-object / missing input", () => {
    expect(normalizeBoards(null)).toBeNull();
    expect(normalizeBoards("not an object")).toBeNull();
    expect(normalizeBoards(undefined)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { buildPoStory, buildDevTask, buildDraftPair } from "./ticketTemplates";

describe("ticketTemplates", () => {
  describe("buildPoStory", () => {
    it("produces a non-empty summary from the feature description", () => {
      const draft = buildPoStory("Password reset via email");
      expect(draft.summary.length).toBeGreaterThan(0);
      expect(draft.summary).toBe("Password reset via email");
    });

    it("summary is ≤ 255 characters", () => {
      const longDesc = "A".repeat(300);
      const draft = buildPoStory(longDesc);
      expect(draft.summary.length).toBeLessThanOrEqual(255);
    });

    it("description contains user-story phrasing", () => {
      const draft = buildPoStory("Dark mode support");
      expect(draft.description).toContain("I want");
      expect(draft.description).toContain("so that");
    });

    it("description contains Given/When/Then scaffold", () => {
      const draft = buildPoStory("Dark mode support");
      expect(draft.description).toContain("Given");
      expect(draft.description).toContain("When");
      expect(draft.description).toContain("Then");
    });

    it("includes story points note when provided", () => {
      const draft = buildPoStory("Feature X", 5);
      expect(draft.description).toContain("5");
    });

    it("does not include story points note when not provided", () => {
      const draft = buildPoStory("Feature X");
      expect(draft.description).not.toContain("story points: undefined");
    });

    it("uses first line as summary when multi-line description", () => {
      const draft = buildPoStory("First line\nSecond line\nThird line");
      expect(draft.summary).toBe("First line");
    });
  });

  describe("buildDevTask", () => {
    it("summary starts with 'Implement:'", () => {
      const draft = buildDevTask("Payment gateway integration");
      expect(draft.summary.startsWith("Implement:")).toBe(true);
    });

    it("summary is ≤ 255 characters", () => {
      const longDesc = "X".repeat(300);
      const draft = buildDevTask(longDesc);
      expect(draft.summary.length).toBeLessThanOrEqual(255);
    });

    it("description contains implementation checklist items", () => {
      const draft = buildDevTask("CI pipeline setup");
      expect(draft.description).toContain("Implementation Checklist");
      expect(draft.description).toContain("- [ ]");
    });

    it("description contains Definition of Done section", () => {
      const draft = buildDevTask("API integration");
      expect(draft.description).toContain("Definition of Done");
    });

    it("includes technical notes section when provided", () => {
      const draft = buildDevTask("Feature Y", "Use Redis for caching");
      expect(draft.description).toContain("Technical Notes");
      expect(draft.description).toContain("Use Redis for caching");
    });

    it("does not include technical notes section when not provided", () => {
      const draft = buildDevTask("Feature Y");
      expect(draft.description).not.toContain("Technical Notes");
    });
  });

  describe("buildDraftPair", () => {
    it("returns both po and dev drafts", () => {
      const pair = buildDraftPair("SSO login via GitHub");
      expect(pair.po).toBeDefined();
      expect(pair.dev).toBeDefined();
    });

    it("po and dev have different summaries", () => {
      const pair = buildDraftPair("SSO login via GitHub");
      expect(pair.po.summary).not.toBe(pair.dev.summary);
    });

    it("dev summary starts with Implement:", () => {
      const pair = buildDraftPair("SSO login via GitHub");
      expect(pair.dev.summary.startsWith("Implement:")).toBe(true);
    });

    it("passes story points to po draft", () => {
      const pair = buildDraftPair("Feature Z", 8);
      expect(pair.po.description).toContain("8");
    });

    it("passes technical notes to dev draft", () => {
      const pair = buildDraftPair("Feature Z", undefined, "Use TypeScript strict");
      expect(pair.dev.description).toContain("Use TypeScript strict");
    });
  });
});

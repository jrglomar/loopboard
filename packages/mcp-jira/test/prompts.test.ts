import { describe, it, expect } from "vitest";
import {
  draftTicketsPrompt,
  enhanceTicketPrompt,
  dailyHuddlePrompt,
} from "../src/lib/prompts.js";

describe("draftTicketsPrompt", () => {
  it("includes the feature description", () => {
    const text = draftTicketsPrompt("Add password reset via email");
    expect(text).toContain("Add password reset via email");
  });

  it("mentions create_po_ticket", () => {
    const text = draftTicketsPrompt("foo");
    expect(text).toContain("create_po_ticket");
  });

  it("mentions create_dev_ticket", () => {
    const text = draftTicketsPrompt("foo");
    expect(text).toContain("create_dev_ticket");
  });

  it("mentions Given/When/Then", () => {
    const text = draftTicketsPrompt("foo");
    expect(text).toContain("Given/When/Then");
  });

  it("returns a non-empty string", () => {
    expect(draftTicketsPrompt("some feature").length).toBeGreaterThan(50);
  });
});

describe("enhanceTicketPrompt", () => {
  it("includes the ticket key", () => {
    const text = enhanceTicketPrompt("DEV-42");
    expect(text).toContain("DEV-42");
  });

  it("mentions get_ticket", () => {
    const text = enhanceTicketPrompt("DEV-42");
    expect(text).toContain("get_ticket");
  });

  it("mentions update_ticket", () => {
    const text = enhanceTicketPrompt("DEV-42");
    expect(text).toContain("update_ticket");
  });

  it("mentions acceptance criteria", () => {
    const text = enhanceTicketPrompt("PO-1");
    expect(text.toLowerCase()).toContain("acceptance criteria");
  });
});

describe("dailyHuddlePrompt", () => {
  it("mentions get_daily_huddle", () => {
    const text = dailyHuddlePrompt();
    expect(text).toContain("get_daily_huddle");
  });

  it("includes boardId when provided", () => {
    const text = dailyHuddlePrompt("12345");
    expect(text).toContain("12345");
  });

  it("works without boardId", () => {
    const text = dailyHuddlePrompt();
    expect(text.length).toBeGreaterThan(30);
  });

  it("mentions standup", () => {
    const text = dailyHuddlePrompt();
    expect(text.toLowerCase()).toContain("standup");
  });
});

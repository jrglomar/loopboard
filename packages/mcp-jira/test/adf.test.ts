import { describe, it, expect } from "vitest";
import { textToAdf, adfToText } from "../src/lib/adf.js";

describe("textToAdf", () => {
  it("converts a plain paragraph", () => {
    const adf = textToAdf("Hello world");
    expect(adf.type).toBe("doc");
    expect(adf.content).toHaveLength(1);
    expect(adf.content[0].type).toBe("paragraph");
  });

  it("converts a heading level 2", () => {
    const adf = textToAdf("## My Heading");
    expect(adf.content[0].type).toBe("heading");
    const heading = adf.content[0] as { type: string; attrs: { level: number }; content: { text: string }[] };
    expect(heading.attrs.level).toBe(2);
    expect(heading.content[0].text).toBe("My Heading");
  });

  it("converts a heading level 3", () => {
    const adf = textToAdf("### Sub Heading");
    const heading = adf.content[0] as { type: string; attrs: { level: number } };
    expect(heading.type).toBe("heading");
    expect(heading.attrs.level).toBe(3);
  });

  it("converts bullet list items", () => {
    const adf = textToAdf("- item one\n- item two\n- item three");
    expect(adf.content[0].type).toBe("bulletList");
    const list = adf.content[0] as { type: string; content: unknown[] };
    expect(list.content).toHaveLength(3);
  });

  it("separates paragraphs by blank lines", () => {
    const adf = textToAdf("First para\n\nSecond para");
    expect(adf.content).toHaveLength(2);
    expect(adf.content[0].type).toBe("paragraph");
    expect(adf.content[1].type).toBe("paragraph");
  });

  it("handles mixed content: heading + bullets + paragraph", () => {
    const text = "## Overview\n- item 1\n- item 2\n\nMore details here.";
    const adf = textToAdf(text);
    expect(adf.content[0].type).toBe("heading");
    expect(adf.content[1].type).toBe("bulletList");
    expect(adf.content[2].type).toBe("paragraph");
  });

  it("handles empty string", () => {
    const adf = textToAdf("");
    expect(adf.content).toHaveLength(0);
  });

  it("sets version to 1", () => {
    expect(textToAdf("hi").version).toBe(1);
  });
});

describe("adfToText", () => {
  it("round-trips a plain paragraph", () => {
    const text = "Hello world";
    const adf = textToAdf(text);
    expect(adfToText(adf)).toBe(text);
  });

  it("round-trips a heading", () => {
    const text = "## My Heading";
    const adf = textToAdf(text);
    const result = adfToText(adf);
    expect(result).toContain("My Heading");
  });

  it("round-trips bullet items", () => {
    const text = "- alpha\n- beta";
    const adf = textToAdf(text);
    const result = adfToText(adf);
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
  });

  it("round-trips multiple paragraphs", () => {
    const text = "First\n\nSecond";
    const adf = textToAdf(text);
    const result = adfToText(adf);
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("returns empty string for null", () => {
    expect(adfToText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(adfToText(undefined)).toBe("");
  });

  it("returns empty string for empty doc", () => {
    const emptyDoc = { version: 1, type: "doc", content: [] };
    expect(adfToText(emptyDoc)).toBe("");
  });

  it("tolerates missing content array", () => {
    const truncated = { version: 1, type: "doc" };
    expect(adfToText(truncated)).toBe("");
  });

  it("round-trips complex mixed content", () => {
    const text = "## Title\n- bullet\n\nSome paragraph text.";
    const adf = textToAdf(text);
    const result = adfToText(adf);
    expect(result).toContain("Title");
    expect(result).toContain("bullet");
    expect(result).toContain("Some paragraph text.");
  });
});

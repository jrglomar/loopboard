// Guide page — v1.49, ADR-060. Static content; renders offline with no mocks.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { Guide } from "./Guide";
import { TOOL_CATALOG } from "../lib/toolCatalog";

afterEach(() => cleanup());

describe("Guide page (v1.49)", () => {
  it("renders the title and a getting-started section", () => {
    render(<Guide />);
    expect(screen.getByRole("heading", { level: 1, name: /using invokeboard/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /getting started/i })).toBeTruthy();
  });

  it("has a table of contents that anchors to every section", () => {
    render(<Guide />);
    const toc = screen.getByRole("navigation", { name: /guide contents/i });
    const links = within(toc).getAllByRole("link");
    // one TOC link per section, each pointing at an in-page anchor that exists
    // v1.61 (ADR-073, item 179): 13 → 12 sections — the ticket→prompt helper section retired.
    expect(links.length).toBeGreaterThanOrEqual(12);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("#")).toBe(true);
      expect(document.getElementById(href.slice(1))).toBeTruthy();
    }
  });

  it("covers the key surfaces users need to learn", () => {
    render(<Guide />);
    for (const name of [/huddle/i, /planning/i, /connections/i, /admin/i, /ai assistant/i]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
  });

  // v1.61 (ADR-073, item 179): the ticket→prompt helper UI is retired — no nav entry or
  // section remains (its old anchor id was "task-helper").
  it("no longer has the retired helper section (v1.61, ADR-073)", () => {
    render(<Guide />);
    expect(document.getElementById("task-helper")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: /ticket → prompt/i })).toBeNull();
  });
});

describe("Guide MCP tool sections (v1.56, ADR-067)", () => {
  it("renders both new section headings", () => {
    render(<Guide />);
    expect(screen.getByRole("heading", { level: 2, name: /using the mcp tools/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /tool reference/i })).toBeTruthy();
  });

  it("renders every tool from the catalog somewhere on the page (self-verifying completeness)", () => {
    render(<Guide />);
    for (const t of TOOL_CATALOG) {
      expect(screen.getAllByText(t.name).length).toBeGreaterThan(0);
    }
  });

  it("renders the Tool reference legend", () => {
    render(<Guide />);
    expect(screen.getByText(/observes only/i)).toBeTruthy();
    expect(screen.getByText(/changes data/i)).toBeTruthy();
  });

  it("renders type badges for every surface x access combination", () => {
    render(<Guide />);
    expect(screen.getAllByText(/Jira · Read/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jira · Write/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Local · Write/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GitHub · Read/).length).toBeGreaterThan(0);
  });

  it("the 'Using the MCP tools' section names .vscode/mcp.json and an example prompt", () => {
    render(<Guide />);
    const section = document.getElementById("mcp-tools");
    expect(section).toBeTruthy();
    const scoped = within(section as HTMLElement);
    expect(scoped.getByText(".vscode/mcp.json")).toBeTruthy();
    expect(
      scoped.getByText(/Create a PO story and a linked dev task for CSV export on the Reports page/i)
    ).toBeTruthy();
  });
});

// Markdown renderer tests (v1.71, ADR-082) — rendering + sanitization. Keyless/offline.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(() => cleanup());

describe("Markdown (v1.71, ADR-082)", () => {
  it("renders bold, lists, and new-tab links", () => {
    const { container } = render(
      <Markdown text={"**bold** text\n\n- one\n- two\n\n[link](https://example.com)"} />
    );

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("li")).toHaveLength(2);

    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("renders GFM tables", () => {
    const { container } = render(
      <Markdown text={"| A | B |\n| - | - |\n| 1 | 2 |"} />
    );
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("th")).toHaveLength(2);
  });

  it("sanitizes dangerous HTML — scripts and inline handlers are stripped", () => {
    const { container } = render(
      <Markdown text={"hi <script>alert(1)</script> <img src=x onerror=alert(1)>"} />
    );
    expect(container.querySelector("script")).toBeNull();
    const img = container.querySelector("img");
    // DOMPurify keeps the img but removes the event-handler attribute.
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("renders nothing structural for empty text", () => {
    const { container } = render(<Markdown text={""} />);
    expect(container.textContent).toBe("");
  });
});

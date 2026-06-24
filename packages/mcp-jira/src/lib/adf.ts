/**
 * ADF (Atlassian Document Format) helpers.
 *
 * textToAdf: plain-text → ADF doc (paragraphs, ## headings, - bullets)
 * adfToText: ADF doc → plain text (tolerates null/absent docs)
 *
 * No external dependencies. Deterministic. No LLM calls.
 */

// ---- ADF node types (minimal, sufficient for our use) ----

interface AdfTextNode {
  type: "text";
  text: string;
}

interface AdfParagraphNode {
  type: "paragraph";
  content: AdfTextNode[];
}

interface AdfHeadingNode {
  type: "heading";
  attrs: { level: number };
  content: AdfTextNode[];
}

interface AdfListItemNode {
  type: "listItem";
  content: AdfParagraphNode[];
}

interface AdfBulletListNode {
  type: "bulletList";
  content: AdfListItemNode[];
}

type AdfBlockNode =
  | AdfParagraphNode
  | AdfHeadingNode
  | AdfBulletListNode;

interface AdfDoc {
  version: number;
  type: "doc";
  content: AdfBlockNode[];
}

// ---- textToAdf ----

/**
 * Convert plain text to an ADF document.
 *
 * Supported syntax:
 * - `## text` → heading level 2
 * - `### text` → heading level 3
 * - `- text` → bullet list item
 * - blank lines separate paragraphs
 * - contiguous `- ` lines form a single bulletList node
 */
export function textToAdf(text: string): AdfDoc {
  const lines = text.split("\n");
  const content: AdfBlockNode[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading level 3 (### before ##)
    if (line.startsWith("### ")) {
      content.push({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: line.slice(4) }],
      });
      i++;
      continue;
    }

    // Heading level 2
    if (line.startsWith("## ")) {
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: line.slice(3) }],
      });
      i++;
      continue;
    }

    // Bullet list — collect consecutive bullet lines into one bulletList node
    if (line.startsWith("- ")) {
      const listItems: AdfListItemNode[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        listItems.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: lines[i].slice(2) }],
            },
          ],
        });
        i++;
      }
      content.push({ type: "bulletList", content: listItems });
      continue;
    }

    // Blank line — skip (paragraph separator)
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph — collect contiguous non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("- ")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: paraLines.join("\n") }],
      });
    }
  }

  return { version: 1, type: "doc", content };
}

// ---- adfToText ----

type AdfUnknown = {
  type?: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
};

/**
 * Extract readable plain text from an ADF document.
 *
 * Tolerates null/absent/truncated docs → "". Unlike a naive text-only walk, this
 * preserves the block structure that matters for a downstream reader (e.g. feeding a
 * PO description to the AI planner):
 *  - paragraphs/headings are blank-line separated (headings keep their "## " marker)
 *  - bullet/ordered list items each land on their own line with a "- " / "N. " marker
 *    (nested lists are indented), instead of being concatenated into a run-on
 *  - `hardBreak` becomes a newline
 *  - inline nodes that carry their text in `attrs` (mention, emoji, inline/blockCard)
 *    contribute that text rather than being silently dropped
 */
export function adfToText(adf: unknown): string {
  if (adf === null || adf === undefined) return "";
  return renderNode(adf as AdfUnknown)
    .replace(/[ \t]+\n/g, "\n") // strip trailing spaces on each line
    .replace(/\n{3,}/g, "\n\n") // collapse runs of blank lines
    .trim();
}

function childrenOf(node: AdfUnknown): AdfUnknown[] {
  return Array.isArray(node.content) ? (node.content as AdfUnknown[]) : [];
}

function attrText(node: AdfUnknown, ...keys: string[]): string {
  const attrs = node.attrs;
  if (!attrs) return "";
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function renderNode(node: AdfUnknown): string {
  if (!node || typeof node !== "object") return "";

  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "hardBreak":
      return "\n";
    case "mention":
      return attrText(node, "text");
    case "emoji":
      return attrText(node, "text", "shortName");
    case "inlineCard":
    case "blockCard":
      return attrText(node, "url");
    case "paragraph": {
      return childrenOf(node).map(renderNode).join("");
    }
    case "heading": {
      const inner = childrenOf(node).map(renderNode).join("");
      const lvl = typeof node.attrs?.["level"] === "number" ? (node.attrs["level"] as number) : 2;
      return `${"#".repeat(Math.max(1, Math.min(6, lvl)))} ${inner}`;
    }
    case "codeBlock":
      return childrenOf(node).map(renderNode).join("");
    case "bulletList":
      return childrenOf(node).map((li) => renderListItem(li, "- ")).join("\n");
    case "orderedList": {
      const start = typeof node.attrs?.["order"] === "number" ? (node.attrs["order"] as number) : 1;
      return childrenOf(node).map((li, i) => renderListItem(li, `${start + i}. `)).join("\n");
    }
    case "listItem":
      // Normally reached via renderListItem; fall back to newline-joined children.
      return childrenOf(node).map(renderNode).filter((s) => s.length > 0).join("\n");
    default:
      // doc + other block containers (blockquote, panel, table, …): blank-line separated.
      return childrenOf(node).map(renderNode).filter((s) => s.length > 0).join("\n\n");
  }
}

/** Render one list item: marker on the first line, continuation lines indented to align. */
function renderListItem(item: AdfUnknown, marker: string): string {
  const body = childrenOf(item).map(renderNode).filter((s) => s.length > 0).join("\n");
  const pad = " ".repeat(marker.length);
  return body
    .split("\n")
    .map((ln, i) => (i === 0 ? marker + ln : pad + ln))
    .join("\n");
}

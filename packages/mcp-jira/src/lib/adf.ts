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

/**
 * Extract plain text from an ADF document.
 * Tolerates null/absent doc → returns "".
 * Paragraphs, headings, and list items are separated by newlines.
 */
export function adfToText(adf: unknown): string {
  if (adf === null || adf === undefined) return "";

  const parts: string[] = [];
  collectText(adf as Record<string, unknown>, parts);
  return parts.join("\n");
}

function collectText(node: Record<string, unknown>, parts: string[]): void {
  if (!node || typeof node !== "object") return;

  const nodeType = node["type"] as string | undefined;

  if (nodeType === "text") {
    const text = node["text"];
    if (typeof text === "string" && text.length > 0) {
      parts.push(text);
    }
    return;
  }

  // For block-level nodes, gather children text then treat as one segment
  if (
    nodeType === "paragraph" ||
    nodeType === "heading" ||
    nodeType === "listItem"
  ) {
    const childParts: string[] = [];
    const children = node["content"];
    if (Array.isArray(children)) {
      for (const child of children) {
        collectText(child as Record<string, unknown>, childParts);
      }
    }
    if (childParts.length > 0) {
      parts.push(childParts.join(""));
    }
    return;
  }

  // For container nodes (doc, bulletList, orderedList, etc.) just recurse
  const children = node["content"];
  if (Array.isArray(children)) {
    for (const child of children) {
      collectText(child as Record<string, unknown>, parts);
    }
  }
}

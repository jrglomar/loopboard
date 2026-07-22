// Markdown renderer for assistant answers (v1.71, ADR-082).
//
// marked → HTML → DOMPurify → dangerouslySetInnerHTML — the same markup→sanitize→render pattern the
// Huddle notes use (RichTextEditor.tsx, ADR-051). Handles PARTIAL markdown so it re-renders cleanly
// on every streamed delta. An ISOLATED `Marked` instance carries a link renderer that opens links in
// a new tab (external Jira/GitHub links must not navigate the SPA away) without touching global marked.

import { useMemo } from "react";
import { Marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Isolated instance — configuring/overriding here never affects other marked users in the app.
const md = new Marked({ gfm: true, breaks: true });
md.use({
  renderer: {
    link(token: Tokens.Link): string {
      // `this` is the renderer; parseInline renders the link's child tokens (bold/code inside a link).
      const self = this as unknown as { parser: { parseInline: (t: Tokens.Link["tokens"]) => string } };
      const text = self.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : "";
      return `<a href="${escapeAttr(token.href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

// Element styling via Tailwind arbitrary variants (the typography plugin isn't installed). Kept
// compact and theme-token-based so it reads correctly in light and dark.
const PROSE = cn(
  "text-sm leading-relaxed break-words",
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5",
  "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1",
  "[&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1",
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_strong]:font-semibold [&_hr]:my-2 [&_hr]:border-border",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.8125rem] [&_code]:font-mono",
  "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:whitespace-pre",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:block [&_table]:overflow-x-auto",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground"
);

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    const raw = md.parse(text, { async: false }) as string;
    // DOMPurify strips scripts/handlers and unsafe URLs; allow the target attr our link renderer adds.
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  }, [text]);

  return (
    <div
      className={cn(PROSE, className)}
      // Safe: `html` is DOMPurify-sanitized on every render.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

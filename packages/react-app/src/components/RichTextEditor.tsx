// RichTextEditor (v1.41, ADR-051) — a small TipTap-based WYSIWYG editor for the Huddle's
// meeting notes: bold / italic / strikethrough / H2 / lists / links. Emits HTML via onChange;
// the CALLER sanitizes (DOMPurify) before persisting or rendering.
//
// a11y: toolbar buttons carry aria-labels + aria-pressed for active marks; the content area
// is labeled. perf: one editor instance per mount; toolbar re-renders are driven by TipTap.

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Italic, Strikethrough, Heading2, List, ListOrdered, Link2, Link2Off,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface RichTextEditorProps {
  /** Initial HTML content (already-sanitized store value). */
  initialHtml: string;
  /** Fired with the editor's current HTML on every change. */
  onChange: (html: string) => void;
}

function ToolbarButton({
  onClick, active, label, children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus
      onClick={onClick}
      aria-label={label}
      aria-pressed={active ?? false}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ initialHtml, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      // v3 StarterKit bundles Link — configure it here (no separate extension → no dup warning).
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
    ],
    content: initialHtml,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        // a11y: labeled editable region; styling for the content inside the editor
        "aria-label": "Meeting notes editor",
        class: cn(
          "min-h-[140px] max-h-[360px] overflow-y-auto px-3 py-2 text-sm focus:outline-none",
          "[&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_h2]:text-sm [&_h2]:font-bold [&_h3]:text-[0.8125rem] [&_h3]:font-semibold [&_p]:my-1"
        ),
      },
    },
  });

  if (!editor) return null;

  function setLink() {
    if (!editor) return;
    const prev = (editor.getAttributes("link")["href"] as string | undefined) ?? "";
    // Simple prompt keeps the control dependency-free; cancel = no-op, empty = remove.
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="rounded-md border border-border bg-background">
      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex items-center gap-0.5 flex-wrap border-b border-border px-1.5 py-1"
      >
        <ToolbarButton label="Bold" active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Strikethrough" active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <span className="w-px h-4 bg-border mx-1" aria-hidden="true" />
        <ToolbarButton label="Heading" active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <span className="w-px h-4 bg-border mx-1" aria-hidden="true" />
        <ToolbarButton label="Add link" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Remove link"
          onClick={() => editor.chain().focus().unsetLink().run()}>
          <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}

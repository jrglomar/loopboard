// MeetingNotesCard (v1.41, ADR-051) — rich per-sprint meeting notes on the Huddle sidebar:
// deployment notes, links, checklists. View = sanitized HTML; Edit = TipTap WYSIWYG.
// DOMPurify sanitizes BOTH on save and on render (defense in depth; the store is dumb).

import { useRef, useState } from "react";
import DOMPurify from "dompurify";
import { NotebookPen, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "./RichTextEditor";
import { useMeetingNotes } from "../hooks/useJira";
import { useCollapse } from "../hooks/useCollapse";
import { CollapseToggle } from "./CollapseToggle";
import { cn } from "@/lib/utils";

// Links in saved notes always open in a new tab, safely.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function sanitizeNotesHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

/** Shared content styling for rendered notes (mirrors the editor's classes). */
const NOTES_CONTENT_CLS = cn(
  "text-sm text-foreground break-words",
  "[&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_h2]:text-sm [&_h2]:font-bold [&_h3]:text-[0.8125rem] [&_h3]:font-semibold [&_p]:my-1"
);

export function MeetingNotesCard({ sprintId }: { sprintId: number | null }) {
  const { data, loading, error, save } = useMeetingNotes(sprintId);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The editor's latest HTML — a ref, so keystrokes never re-render the card.
  const draftRef = useRef("");
  const [collapsed, toggleCollapsed] = useCollapse("meetingNotes");

  function startEdit() {
    draftRef.current = data?.html ?? "";
    setSaveError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      // Sanitize BEFORE persisting; an emptied editor ("<p></p>") clears the notes.
      const clean = sanitizeNotesHtml(draftRef.current);
      const isEmpty = clean.replace(/<[^>]*>/g, "").trim() === "";
      await save(isEmpty ? "" : clean);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const updatedLabel = data
    ? new Date(data.updatedAt).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground min-w-0 flex-1">
            <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} className="w-full">
              <NotebookPen className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
              Meeting notes
              {loading && (
                <span className="text-[0.6875rem] font-normal text-muted-foreground animate-pulse ml-1">
                  Loading…
                </span>
              )}
            </CollapseToggle>
          </h3>
          {!editing && !collapsed && (
            <Button
              type="button" variant="ghost" size="sm"
              className="h-6 px-2 text-xs shrink-0"
              onClick={startEdit}
              disabled={sprintId === null}
            >
              {data ? "Edit" : "Add notes"}
            </Button>
          )}
        </div>
      </CardHeader>
      {!collapsed && (
      <CardContent className="px-3 pb-3 space-y-2">
        {sprintId === null ? (
          <p className="text-sm text-muted-foreground">Select a sprint to keep meeting notes.</p>
        ) : editing ? (
          <>
            <RichTextEditor
              initialHtml={data?.html ?? ""}
              onChange={(html) => { draftRef.current = html; }}
            />
            {saveError && (
              <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" size="sm" className="h-7 text-xs"
                onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save notes"}
              </Button>
            </div>
          </>
        ) : data ? (
          <>
            {/* Sanitized on render too — the store is treated as untrusted input. */}
            <div
              className={NOTES_CONTENT_CLS}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(data.html) }}
            />
            {updatedLabel && (
              <p className="text-[0.6875rem] text-muted-foreground">Updated {updatedLabel}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No notes yet — keep deployment notes, links, and reminders here for the huddle.
          </p>
        )}
        {error && !editing && (
          <p className="text-xs text-destructive flex items-center gap-1" aria-live="polite">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {error.message}
          </p>
        )}
      </CardContent>
      )}
    </Card>
  );
}

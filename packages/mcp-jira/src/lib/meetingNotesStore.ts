/**
 * Meeting-notes store — JSON file read/write for the per-sprint RICH meeting notes
 * (deployment notes, links…) shown on the Huddle with a WYSIWYG editor (v1.41, ADR-051).
 *
 * Shape: { [sprintId: string]: { html: string; updatedAt: string } }
 *
 * The value is an HTML string produced by the app's editor; this store is content-agnostic —
 * the React app sanitizes with DOMPurify on save AND on render (the server never parses HTML).
 * v1.65 (ADR-077): reads/writes go through the storage port (json driver by default; still
 * honors JIRA_MEETING_NOTES_FILE). Reads tolerate a missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

export interface MeetingNotes {
  html: string;
  updatedAt: string; // ISO timestamp
}

/** File-level shape: sprintId (string key) → MeetingNotes */
export type MeetingNotesFile = Record<string, MeetingNotes>;

/** Read the meeting-notes file. Returns {} on ENOENT or any JSON parse error. */
export function readMeetingNotes(): MeetingNotesFile {
  const parsed = readDoc(currentScope(), "meeting-notes");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as MeetingNotesFile;
}

/** Write the meeting-notes doc via the storage port. */
export function writeMeetingNotes(data: MeetingNotesFile): void {
  writeDoc(currentScope(), "meeting-notes", data);
}

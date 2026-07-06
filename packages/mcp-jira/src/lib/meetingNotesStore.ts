/**
 * Meeting-notes store — JSON file read/write for the per-sprint RICH meeting notes
 * (deployment notes, links…) shown on the Huddle with a WYSIWYG editor (v1.41, ADR-051).
 *
 * Shape: { [sprintId: string]: { html: string; updatedAt: string } }
 *
 * The value is an HTML string produced by the app's editor; this store is content-agnostic —
 * the React app sanitizes with DOMPurify on save AND on render (the server never parses HTML).
 * Path is read from config at call time so tests can override JIRA_MEETING_NOTES_FILE first.
 * Reads tolerate a missing/corrupt file (returns {}). Writes create the file + parent dirs.
 */

import * as fs from "fs";
import * as path from "path";
import { getMeetingNotesFilePath } from "./config.js";

export interface MeetingNotes {
  html: string;
  updatedAt: string; // ISO timestamp
}

/** File-level shape: sprintId (string key) → MeetingNotes */
export type MeetingNotesFile = Record<string, MeetingNotes>;

/** Read the meeting-notes file. Returns {} on ENOENT or any JSON parse error. */
export function readMeetingNotes(): MeetingNotesFile {
  const filePath = getMeetingNotesFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as MeetingNotesFile;
  } catch {
    return {};
  }
}

/** Write the meeting-notes file, creating parent directories as needed. */
export function writeMeetingNotes(data: MeetingNotesFile): void {
  const filePath = getMeetingNotesFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

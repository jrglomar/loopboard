// Meeting-notes client (v1.41, ADR-051) — wraps get_meeting_notes / set_meeting_notes.
// CONTRACTS.md §4.27. The html is produced by the WYSIWYG editor and sanitized by the caller.

import { callTool } from "./mcpClient";

export interface MeetingNotesData {
  html: string;
  updatedAt: string; // ISO timestamp
}

interface MeetingNotesEnvelope {
  sprintId: number;
  notes: MeetingNotesData | null;
}

/** Fetch the sprint's meeting notes; null when never set/cleared. */
export async function getMeetingNotes(sprintId: number): Promise<MeetingNotesData | null> {
  const res = await callTool<MeetingNotesEnvelope>("jira", "get_meeting_notes", { sprintId });
  return res.notes;
}

/** Replace the sprint's meeting notes (empty html clears). Returns the stored notes (or null). */
export async function setMeetingNotes(
  sprintId: number,
  html: string
): Promise<MeetingNotesData | null> {
  const res = await callTool<MeetingNotesEnvelope>("jira", "set_meeting_notes", { sprintId, html });
  return res.notes;
}

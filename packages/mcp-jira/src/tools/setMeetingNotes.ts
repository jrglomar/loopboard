import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import {
  readMeetingNotes,
  writeMeetingNotes,
  type MeetingNotes,
} from "../lib/meetingNotesStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
  // HTML from the app's editor (sanitized client-side). Empty/whitespace clears the entry.
  html: z.string().max(100_000),
});

interface SetMeetingNotesOutput {
  sprintId: number;
  notes: MeetingNotes | null;
}

async function handler(input: unknown): Promise<SetMeetingNotesOutput> {
  const args = schema.parse(input);
  const all = readMeetingNotes();
  const key = String(args.sprintId);

  if (args.html.trim() === "") {
    delete all[key]; // clearing — subsequent gets return null
    writeMeetingNotes(all);
    return { sprintId: args.sprintId, notes: null };
  }

  const notes: MeetingNotes = { html: args.html, updatedAt: new Date().toISOString() };
  all[key] = notes;
  writeMeetingNotes(all);
  return { sprintId: args.sprintId, notes };
}

export const setMeetingNotes: ToolDef = {
  name: "set_meeting_notes",
  description:
    "Replace the sprint's rich meeting notes with the given HTML (from the Huddle's WYSIWYG " +
    "editor); empty html clears them. Stamps updatedAt. Input { sprintId, html }; output " +
    "{ sprintId, notes }. Local JSON store — no Jira calls.",
  schema,
  handler,
};

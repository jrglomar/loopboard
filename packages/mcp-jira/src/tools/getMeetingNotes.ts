import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readMeetingNotes, type MeetingNotes } from "../lib/meetingNotesStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetMeetingNotesOutput {
  sprintId: number;
  notes: MeetingNotes | null;
}

async function handler(input: unknown): Promise<GetMeetingNotesOutput> {
  const args = schema.parse(input);
  const all = readMeetingNotes();
  return { sprintId: args.sprintId, notes: all[String(args.sprintId)] ?? null };
}

export const getMeetingNotes: ToolDef = {
  name: "get_meeting_notes",
  description:
    "Get the sprint's rich meeting notes (deployment notes, links) as saved from the Huddle's " +
    "WYSIWYG editor. Input { sprintId }; output { sprintId, notes: { html, updatedAt } | null }. " +
    "Local JSON store — read-only, no Jira calls.",
  schema,
  handler,
};

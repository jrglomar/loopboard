/**
 * move_issue_to_sprint tool (v1.15, ADR-026) — WRITE.
 *
 * Move a ticket to a chosen sprint. Reuses addIssuesToSprint — adding an issue to a
 * sprint moves it out of any prior sprint (Agile API semantics). Used by the Planning
 * ticket list.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { addIssuesToSprint } from "../lib/jiraClient.js";

const schema = z.object({
  ticketKey: z.string().min(1),
  sprintId: z.number().int().positive(),
});

interface MoveIssueToSprintOutput {
  ticketKey: string;
  sprintId: number;
}

async function handler(input: unknown): Promise<MoveIssueToSprintOutput> {
  const args = schema.parse(input);
  await addIssuesToSprint(args.sprintId, [args.ticketKey]);
  return { ticketKey: args.ticketKey, sprintId: args.sprintId };
}

export const moveIssueToSprintTool: ToolDef = {
  name: "move_issue_to_sprint",
  description:
    "Move a Jira ticket to a sprint (POST /rest/agile/1.0/sprint/{id}/issue). Adding an issue to a " +
    "sprint moves it out of its previous sprint. A real write. Returns { ticketKey, sprintId }.",
  schema,
  handler,
};

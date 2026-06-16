import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { TicketRef } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { createIssue, addIssuesToSprint } from "../lib/jiraClient.js";

const schema = z.object({
  summary: z.string().min(1).max(255),
  description: z.string(),
  storyPoints: z.number().min(0).optional(),
  sprintId: z.number().int().positive().optional(),
});

type CreatePoTicketOutput = TicketRef & {
  sprintId?: number;
  sprintWarning?: string;
};

async function handler(input: unknown): Promise<CreatePoTicketOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const key = await createIssue({
    projectKey: cfg.JIRA_PO_PROJECT_KEY,
    summary: args.summary,
    description: args.description,
    issueType: "Story",
    storyPointsField: cfg.JIRA_STORY_POINTS_FIELD,
    storyPoints: args.storyPoints,
  });

  const result: CreatePoTicketOutput = {
    key,
    url: `${cfg.JIRA_BASE_URL}/browse/${key}`,
    board: "PO",
  };

  // Add-to-sprint helper (v1.4) — non-fatal
  if (args.sprintId !== undefined) {
    try {
      await addIssuesToSprint(args.sprintId, [key]);
      result.sprintId = args.sprintId;
    } catch (err) {
      result.sprintWarning =
        err instanceof Error ? err.message : String(err);
    }
  }

  return result;
}

export const createPoTicket: ToolDef = {
  name: "create_po_ticket",
  description:
    "Create a PO Story in Jira. Converts plain-text description to ADF. " +
    "Optionally adds the new ticket to a sprint (sprintId — non-fatal; a sprintWarning is returned on failure). " +
    "Returns the new ticket key, URL, board, and optional sprintId.",
  schema,
  handler,
};

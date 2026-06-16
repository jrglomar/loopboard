import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { TicketRef } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { createIssue, createIssueLink, addIssuesToSprint } from "../lib/jiraClient.js";

const schema = z.object({
  summary: z.string().min(1).max(255),
  description: z.string(),
  linkedPoTicketKey: z.string().optional(),
  sprintId: z.number().int().positive().optional(),
});

type CreateDevTicketOutput = TicketRef & {
  linkedTo?: string;
  linkWarning?: string;
  sprintId?: number;
  sprintWarning?: string;
};

async function handler(input: unknown): Promise<CreateDevTicketOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const key = await createIssue({
    projectKey: cfg.JIRA_DEV_PROJECT_KEY,
    summary: args.summary,
    description: args.description,
    issueType: "Task",
  });

  const result: CreateDevTicketOutput = {
    key,
    url: `${cfg.JIRA_BASE_URL}/browse/${key}`,
    board: "DEV",
  };

  if (args.linkedPoTicketKey !== undefined) {
    try {
      await createIssueLink({
        linkTypeName: cfg.JIRA_LINK_TYPE,
        inwardKey: key,
        outwardKey: args.linkedPoTicketKey,
      });
      result.linkedTo = args.linkedPoTicketKey;
    } catch (err) {
      // Link failure must NOT fail the creation — surface as linkWarning
      result.linkWarning =
        err instanceof Error ? err.message : String(err);
    }
  }

  // Add-to-sprint helper (v1.4) — non-fatal, AFTER the link step
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

export const createDevTicket: ToolDef = {
  name: "create_dev_ticket",
  description:
    "Create a Dev Task in Jira. Optionally links to a PO Story using a generic Jira issue link " +
    "(see ADR-003). Link failure is non-fatal — the ticket is returned with a linkWarning instead. " +
    "Optionally adds the new ticket to a sprint (sprintId — non-fatal; a sprintWarning is returned on failure). " +
    "Sprint is added AFTER the link step.",
  schema,
  handler,
};

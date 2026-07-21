import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getIssue } from "../lib/jiraClient.js";

/** Shared ticketKey format (PROJECT-NUMBER) — reused wherever a Jira issue key is validated. */
export const TICKET_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

const schema = z.object({
  ticketKey: z
    .string()
    .regex(
      TICKET_KEY_REGEX,
      "ticketKey must match PROJECT-NUMBER format"
    ),
});

async function handler(input: unknown): Promise<unknown> {
  const args = schema.parse(input);
  return getIssue(args.ticketKey);
}

export const getTicket: ToolDef = {
  name: "get_ticket",
  description:
    "Fetch a Jira ticket by key (e.g. PO-42). Returns summary, description (plain text), " +
    "status, assignee, reporter, story points, labels, and timestamps.",
  schema,
  handler,
};

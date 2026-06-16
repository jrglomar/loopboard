/**
 * assign_issue tool (v1.7, ADR-018).
 *
 * Assigns (or unassigns with null) a Jira ticket to a developer by accountId.
 * This is a real Jira WRITE — PUT /rest/api/3/issue/{key}/assignee.
 * A 404 surfaces as UPSTREAM "Ticket <key> not found" (consistent with get_ticket / update_ticket).
 * Never logs the accountId.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { assignIssue } from "../lib/jiraClient.js";
import { UpstreamError } from "../lib/errors.js";

const schema = z.object({
  ticketKey: z
    .string()
    .regex(
      /^[A-Z][A-Z0-9]{1,9}-\d+$/,
      "ticketKey must match PROJECT-NUMBER format"
    ),
  // accountId is string (min 1) or null (unassign)
  accountId: z.union([z.string().min(1), z.null()]),
});

interface AssignIssueOutput {
  ticketKey: string;
  accountId: string | null;
  assigned: boolean;
}

async function handler(input: unknown): Promise<AssignIssueOutput> {
  const args = schema.parse(input);

  try {
    await assignIssue(args.ticketKey, args.accountId);
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) {
      throw new UpstreamError(`Ticket ${args.ticketKey} not found`, 404);
    }
    throw err;
  }

  return {
    ticketKey: args.ticketKey,
    accountId: args.accountId,
    assigned: args.accountId !== null,
  };
}

export const assignIssueTool: ToolDef = {
  name: "assign_issue",
  description:
    "Assign (or unassign with null) a ticket to a developer by accountId. " +
    "This is a real Jira write (PUT assignee). Use get_assignable_users to get valid accountIds. " +
    "Pass null as accountId to unassign. Returns assigned: true when accountId is set, false when unassigned.",
  schema,
  handler,
};

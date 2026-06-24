/**
 * transition_issue tool (v1.15, ADR-026) — WRITE.
 *
 * Apply a workflow transition (by id, from get_transitions) to a Jira issue, then
 * return its resulting status. Used by the Planning ticket list to change a story's
 * status (e.g. To Do → In Progress).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { transitionIssue } from "../lib/jiraClient.js";

const schema = z.object({
  ticketKey: z.string().min(1),
  transitionId: z.string().min(1),
});

interface TransitionIssueOutput {
  ticketKey: string;
  status: string;
  statusCategory: "todo" | "inprogress" | "done";
}

async function handler(input: unknown): Promise<TransitionIssueOutput> {
  const args = schema.parse(input);
  return transitionIssue(args.ticketKey, args.transitionId);
}

export const transitionIssueTool: ToolDef = {
  name: "transition_issue",
  description:
    "Apply a workflow transition (transitionId from get_transitions) to a Jira issue, moving it " +
    "to a new status, then return the resulting status. A real write — use get_transitions first " +
    "to find a valid transition id for the issue's current status.",
  schema,
  handler,
};

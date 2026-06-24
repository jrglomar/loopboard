/**
 * get_transitions tool (v1.15, ADR-026).
 *
 * Returns the workflow transitions available from an issue's CURRENT status, so a
 * caller (the Planning ticket list) can offer the valid next statuses. Read-only.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getTransitions, type IssueTransition } from "../lib/jiraClient.js";

const schema = z.object({
  ticketKey: z.string().min(1),
});

interface GetTransitionsOutput {
  ticketKey: string;
  transitions: IssueTransition[];
}

async function handler(input: unknown): Promise<GetTransitionsOutput> {
  const args = schema.parse(input);
  const transitions = await getTransitions(args.ticketKey);
  return { ticketKey: args.ticketKey, transitions };
}

export const getTransitionsTool: ToolDef = {
  name: "get_transitions",
  description:
    "List the workflow transitions available from a Jira issue's current status " +
    "(each with id, name, and the target status + category). Use before transition_issue " +
    "to discover the valid next statuses. Read-only.",
  schema,
  handler,
};

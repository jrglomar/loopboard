/**
 * set_sprint_goal tool (v1.13, ADR-024).
 *
 * Sets (or clears) the goal of an existing sprint — a real WRITE.
 * Lets the Scrum Master keep the sprint goal current; the Dashboard shows it.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { updateSprintGoal } from "../lib/jiraClient.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
  goal: z.string(), // empty string clears the goal
});

interface SetSprintGoalOutput {
  sprintId: number;
  goal: string | null;
}

async function handler(input: unknown): Promise<SetSprintGoalOutput> {
  const args = schema.parse(input);
  const result = await updateSprintGoal(args.sprintId, args.goal);
  return { sprintId: result.id, goal: result.goal };
}

export const setSprintGoalTool: ToolDef = {
  name: "set_sprint_goal",
  description:
    "Set (or clear) the goal of an existing sprint (a real Jira WRITE — partial update via " +
    "POST /rest/agile/1.0/sprint/{id}). Pass an empty string to clear the goal. " +
    "Returns { sprintId, goal }. 404 maps to UPSTREAM.",
  schema,
  handler,
};

/**
 * set_meeting_goal tool (v1.20, ADR-031) — set (or clear) a sprint's "meeting goal"
 * (the daily standup focus). Stamps updatedAt. Distinct from the Jira sprint goal.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readMeetingGoals, writeMeetingGoals } from "../lib/meetingGoalStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
  goal: z.string().max(2000),
});

interface SetMeetingGoalOutput {
  sprintId: number;
  goal: string;
  updatedAt: string | null;
}

async function handler(input: unknown): Promise<SetMeetingGoalOutput> {
  const args = schema.parse(input);
  const all = readMeetingGoals();
  const trimmed = args.goal.trim();
  if (trimmed === "") {
    // Clearing — drop the entry entirely.
    delete all[String(args.sprintId)];
    writeMeetingGoals(all);
    return { sprintId: args.sprintId, goal: "", updatedAt: null };
  }
  const updatedAt = new Date().toISOString();
  all[String(args.sprintId)] = { goal: trimmed, updatedAt };
  writeMeetingGoals(all);
  return { sprintId: args.sprintId, goal: trimmed, updatedAt };
}

export const setMeetingGoalTool: ToolDef = {
  name: "set_meeting_goal",
  description:
    "Set (or clear, when empty) the goal for today's meeting (the daily standup focus) for a " +
    "sprint. Distinct from the Jira sprint goal. Persists to a bridge-side JSON store.",
  schema,
  handler,
};

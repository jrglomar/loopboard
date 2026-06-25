/**
 * get_meeting_goal tool (v1.20, ADR-031).
 * Return the stored "goal for today's meeting" for a sprint (the standup focus).
 * Distinct from the Jira sprint goal (set_sprint_goal).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readMeetingGoals } from "../lib/meetingGoalStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetMeetingGoalOutput {
  sprintId: number;
  goal: string;
  updatedAt: string | null;
}

async function handler(input: unknown): Promise<GetMeetingGoalOutput> {
  const args = schema.parse(input);
  const all = readMeetingGoals();
  const entry = all[String(args.sprintId)];
  return {
    sprintId: args.sprintId,
    goal: entry?.goal ?? "",
    updatedAt: entry?.updatedAt ?? null,
  };
}

export const getMeetingGoalTool: ToolDef = {
  name: "get_meeting_goal",
  description:
    "Return the stored goal for today's meeting (the daily standup focus) for a sprint. This is " +
    "distinct from the Jira sprint goal. Reads a bridge-side JSON store; returns \"\" when unset.",
  schema,
  handler,
};

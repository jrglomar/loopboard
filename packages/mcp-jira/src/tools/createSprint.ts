/**
 * create_sprint tool (v1.4, ADR-011).
 *
 * Creates a new future sprint on a Jira board.
 * POST /rest/agile/1.0/sprint
 * Date-only "YYYY-MM-DD" values are normalized to "...T00:00:00.000Z" before sending.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { SprintRef } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { createSprint as clientCreateSprint } from "../lib/jiraClient.js";

/** Normalize a date string: if it's date-only (YYYY-MM-DD), append T00:00:00.000Z */
export function normalizeDateToISO(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${date}T00:00:00.000Z`;
  }
  return date;
}

// Base schema (ZodObject) — used in the ToolDef registry
const baseSchema = z.object({
  name: z.string().min(1).max(255),
  goal: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  boardId: z.number().int().positive().optional(),
});

// Full schema with start < end refine — used inside the handler
const fullSchema = baseSchema.refine(
  (val) => {
    if (val.startDate !== undefined && val.endDate !== undefined) {
      return normalizeDateToISO(val.startDate) < normalizeDateToISO(val.endDate);
    }
    return true;
  },
  { message: "startDate must be before endDate" }
);

async function handler(input: unknown): Promise<SprintRef> {
  const args = fullSchema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);

  const sprint = await clientCreateSprint({
    name: args.name,
    originBoardId: boardId,
    goal: args.goal,
    startDate:
      args.startDate !== undefined
        ? normalizeDateToISO(args.startDate)
        : undefined,
    endDate:
      args.endDate !== undefined
        ? normalizeDateToISO(args.endDate)
        : undefined,
  });

  return {
    id: sprint.id,
    name: sprint.name,
    state: "future", // Jira always creates a future sprint
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    completeDate: sprint.completeDate,
    goal: sprint.goal,
    boardId: sprint.boardId,
  };
}

export const createSprintTool: ToolDef = {
  name: "create_sprint",
  description:
    "Create a new future sprint on the board with a name, goal, and optional start/end dates. " +
    "Date-only values (YYYY-MM-DD) are automatically normalized to full ISO timestamps. " +
    "startDate must be before endDate when both are provided. " +
    "Returns the created sprint as a SprintRef (state will be 'future').",
  schema: baseSchema, // ZodObject for the registry; refine runs inside handler
  handler,
};

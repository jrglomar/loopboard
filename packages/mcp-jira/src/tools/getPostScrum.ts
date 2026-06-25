/**
 * get_post_scrum tool (v1.20, ADR-031).
 * Return the stored post-scrum notes for a sprint (per-person standup follow-ups).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readPostScrum, type PostScrumNote } from "../lib/postScrumStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetPostScrumOutput {
  sprintId: number;
  notes: PostScrumNote[];
}

async function handler(input: unknown): Promise<GetPostScrumOutput> {
  const args = schema.parse(input);
  const all = readPostScrum();
  return { sprintId: args.sprintId, notes: all[String(args.sprintId)] ?? [] };
}

export const getPostScrumTool: ToolDef = {
  name: "get_post_scrum",
  description:
    "Return the stored post-scrum notes for a sprint (a manual, per-sprint, per-person list of " +
    "post-standup follow-ups for tracking). Reads a bridge-side JSON store; returns [] when none.",
  schema,
  handler,
};

/**
 * get_pull_requests tool (v1.16, ADR-027).
 * Return the stored pending-PR links for a sprint (daily Huddle code-review visibility).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readPrs, type PullRequest } from "../lib/prsStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetPullRequestsOutput {
  sprintId: number;
  pullRequests: PullRequest[];
}

async function handler(input: unknown): Promise<GetPullRequestsOutput> {
  const args = schema.parse(input);
  const all = readPrs();
  return { sprintId: args.sprintId, pullRequests: all[String(args.sprintId)] ?? [] };
}

export const getPullRequestsTool: ToolDef = {
  name: "get_pull_requests",
  description:
    "Return the stored pending pull-request links for a sprint (a manual, per-sprint list for " +
    "daily Huddle code-review visibility). Reads a bridge-side JSON store; returns [] when none.",
  schema,
  handler,
};

/**
 * set_pull_requests tool (v1.16, ADR-027) — full-replace the sprint's PR list.
 * Items may omit id/addedAt — the tool fills them so the client can add a PR with just a url.
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import type { ToolDef } from "../lib/toolDef.js";
import { readPrs, writePrs, type PullRequest } from "../lib/prsStore.js";

const itemSchema = z.object({
  id: z.string().optional(),
  url: z.string().min(1),
  title: z.string().optional(),
  ticketKey: z.string().optional(),
  status: z.string().optional(),
  addedAt: z.string().optional(),
});

const schema = z.object({
  sprintId: z.number().int().positive(),
  pullRequests: z.array(itemSchema).max(200),
});

interface SetPullRequestsOutput {
  sprintId: number;
  pullRequests: PullRequest[];
}

async function handler(input: unknown): Promise<SetPullRequestsOutput> {
  const args = schema.parse(input);
  const now = new Date().toISOString();
  const normalized: PullRequest[] = args.pullRequests.map((p) => ({
    id: p.id ?? randomUUID(),
    url: p.url,
    ...(p.title ? { title: p.title } : {}),
    ...(p.ticketKey ? { ticketKey: p.ticketKey } : {}),
    ...(p.status ? { status: p.status } : {}),
    addedAt: p.addedAt ?? now,
  }));

  const all = readPrs();
  all[String(args.sprintId)] = normalized;
  writePrs(all);
  return { sprintId: args.sprintId, pullRequests: normalized };
}

export const setPullRequestsTool: ToolDef = {
  name: "set_pull_requests",
  description:
    "Replace the stored pending pull-request links for a sprint with the given list (full replace). " +
    "Items may omit id/addedAt — the tool fills them. Persists to a bridge-side JSON store.",
  schema,
  handler,
};

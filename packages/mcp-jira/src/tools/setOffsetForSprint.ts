/**
 * set_offset_for_sprint tool (v1.26, ADR-038).
 * Upsert the AUTO earned/spent snapshot for a sprint (idempotent — replaces that sprint's entry
 * per assignee, so re-recording a sprint never double-counts).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readOffset, writeOffset, summarizeOffset, type OffsetSummary } from "../lib/offsetStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
  entries: z
    .array(
      z.object({
        assignee: z.string().min(1).max(120),
        // v1.55 (ADR-066): decimal-capable (teams may bank/spend fractional offset points).
        earned: z.number().min(0),
        spent: z.number().min(0),
      })
    )
    .min(1)
    .max(200),
});

interface SetOffsetForSprintOutput {
  entries: Record<string, OffsetSummary>;
}

async function handler(input: unknown): Promise<SetOffsetForSprintOutput> {
  const args = schema.parse(input);
  const sprintKey = String(args.sprintId);
  const data = readOffset();

  for (const e of args.entries) {
    const cur = data[e.assignee] ?? { bySprint: {}, manualAdjust: 0 };
    cur.bySprint = { ...cur.bySprint, [sprintKey]: { earned: e.earned, spent: e.spent } };
    data[e.assignee] = cur;
  }

  writeOffset(data);
  return { entries: summarizeOffset(data) };
}

export const setOffsetForSprintTool: ToolDef = {
  name: "set_offset_for_sprint",
  description:
    "Record the auto-computed offset snapshot (earned + spent) for a sprint, per assignee. " +
    "Idempotent: replaces that sprint's entry so re-recording never double-counts. Returns the " +
    "updated per-developer ledger summary.",
  schema,
  handler,
};

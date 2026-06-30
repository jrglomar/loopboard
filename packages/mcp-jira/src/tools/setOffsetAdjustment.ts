/**
 * set_offset_adjustment tool (v1.26, ADR-038).
 * Set a developer's MANUAL absolute offset adjustment (a signed delta added to their balance).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readOffset, writeOffset, summarizeOffset, type OffsetSummary } from "../lib/offsetStore.js";

const schema = z.object({
  assignee: z.string().min(1).max(120),
  manualAdjust: z.number().int(),
});

interface SetOffsetAdjustmentOutput {
  entries: Record<string, OffsetSummary>;
}

async function handler(input: unknown): Promise<SetOffsetAdjustmentOutput> {
  const args = schema.parse(input);
  const data = readOffset();
  const cur = data[args.assignee] ?? { bySprint: {}, manualAdjust: 0 };
  cur.manualAdjust = args.manualAdjust;
  data[args.assignee] = cur;
  writeOffset(data);
  return { entries: summarizeOffset(data) };
}

export const setOffsetAdjustmentTool: ToolDef = {
  name: "set_offset_adjustment",
  description:
    "Set a developer's MANUAL offset adjustment (an absolute signed integer added to their balance, " +
    "on top of the auto-computed earned − spent). Returns the updated per-developer ledger summary.",
  schema,
  handler,
};

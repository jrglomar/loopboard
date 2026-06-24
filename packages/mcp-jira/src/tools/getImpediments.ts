/**
 * get_impediments tool (v1.16, ADR-027).
 * Return the stored impediments/blockers for a sprint (daily Huddle visibility).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readImpediments, type Impediment } from "../lib/impedimentsStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetImpedimentsOutput {
  sprintId: number;
  impediments: Impediment[];
}

async function handler(input: unknown): Promise<GetImpedimentsOutput> {
  const args = schema.parse(input);
  const all = readImpediments();
  return { sprintId: args.sprintId, impediments: all[String(args.sprintId)] ?? [] };
}

export const getImpedimentsTool: ToolDef = {
  name: "get_impediments",
  description:
    "Return the stored impediments/blockers for a sprint (a manual, per-sprint list for daily " +
    "Huddle visibility). Reads a bridge-side JSON store; returns [] when none.",
  schema,
  handler,
};

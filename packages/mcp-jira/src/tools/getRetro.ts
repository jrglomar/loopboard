import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readRetros, type RetroEntry } from "../lib/retroStore.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
});

interface GetRetroOutput {
  sprintId: number;
  retro: RetroEntry | null;
}

async function handler(input: unknown): Promise<GetRetroOutput> {
  const args = schema.parse(input);
  const all = readRetros();
  return { sprintId: args.sprintId, retro: all[String(args.sprintId)] ?? null };
}

export const getRetro: ToolDef = {
  name: "get_retro",
  description:
    "Get the sprint's persisted retrospective (reason for delays, what worked well, what did " +
    "not, planned improvements, kudos). Input { sprintId }; output { sprintId, retro | null }. " +
    "Local JSON store — read-only, no Jira calls.",
  schema,
  handler,
};

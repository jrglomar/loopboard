import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { readRetros, writeRetros, type RetroEntry } from "../lib/retroStore.js";

const field = z.string().max(4000).default("");

const schema = z.object({
  sprintId: z.number().int().positive(),
  reasonForDelays: field,
  whatWorkedWell: field,
  whatDidNotWork: field,
  plannedImprovements: field,
  kudos: field,
});

interface SetRetroOutput {
  sprintId: number;
  retro: RetroEntry | null;
}

async function handler(input: unknown): Promise<SetRetroOutput> {
  const args = schema.parse(input);
  const all = readRetros();
  const key = String(args.sprintId);

  const fields = {
    reasonForDelays: args.reasonForDelays.trim(),
    whatWorkedWell: args.whatWorkedWell.trim(),
    whatDidNotWork: args.whatDidNotWork.trim(),
    plannedImprovements: args.plannedImprovements.trim(),
    kudos: args.kudos.trim(),
  };
  const allEmpty = Object.values(fields).every((v) => v === "");

  if (allEmpty) {
    delete all[key]; // clearing — subsequent gets return null
    writeRetros(all);
    return { sprintId: args.sprintId, retro: null };
  }

  const retro: RetroEntry = { ...fields, updatedAt: new Date().toISOString() };
  all[key] = retro;
  writeRetros(all);
  return { sprintId: args.sprintId, retro };
}

export const setRetro: ToolDef = {
  name: "set_retro",
  description:
    "Replace the sprint's persisted retrospective fields (each optional, ≤4000 chars); " +
    "all-empty clears the entry. Stamps updatedAt. Input { sprintId, ...fields }; output " +
    "{ sprintId, retro }. Local JSON store — no Jira calls.",
  schema,
  handler,
};

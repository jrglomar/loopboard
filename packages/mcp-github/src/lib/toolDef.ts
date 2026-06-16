import { z } from "zod";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (input: unknown) => Promise<unknown>;
}

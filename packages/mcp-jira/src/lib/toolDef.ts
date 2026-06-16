import { z } from "zod";

export interface ToolDef {
  name: string;
  description: string; // read by Claude to decide when to call it
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (input: unknown) => Promise<unknown>; // impl parses with schema internally
}

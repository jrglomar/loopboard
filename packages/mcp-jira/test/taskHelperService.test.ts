// taskHelperService pipeline — v1.44, ADR-054. Mock AiProvider; keyless/offline.

import { describe, it, expect, vi } from "vitest";
import { runTaskHelper } from "../src/lib/ai/taskHelperService.js";
import type { AiProvider } from "../src/lib/ai/provider.js";

function providerReturning(texts: string[]): AiProvider {
  const complete = vi.fn();
  for (const t of texts) complete.mockResolvedValueOnce({ text: t });
  return { name: "anthropic", model: "m", complete, chatWithTools: vi.fn() } as unknown as AiProvider;
}

describe("runTaskHelper", () => {
  it("returns trimmed { refinedText, prompt } from two provider calls", async () => {
    const provider = providerReturning(["  **Problem** ... refined  ", "  ## Context\nagent prompt  "]);
    const result = await runTaskHelper(provider, {
      key: "DEV-1", summary: "Fix login", description: "Users can't log in", issueType: "Bug",
    });
    expect(result.refinedText).toBe("**Problem** ... refined");
    expect(result.prompt).toBe("## Context\nagent prompt");
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("feeds the refined text into the prompt-building call", async () => {
    const provider = providerReturning(["REFINED-XYZ", "PROMPT"]);
    await runTaskHelper(provider, { key: "DEV-2", summary: "s", description: "d", extraContext: "React app" });
    const secondCallUser = (provider.complete as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]![1] as Array<{ content: string }>;
    expect(secondCallUser[0]!.content).toContain("REFINED-XYZ");
    expect(secondCallUser[0]!.content).toContain("React app"); // extra context flows through
  });
});

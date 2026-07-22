/**
 * Provider streaming tests (v1.71, ADR-082) — keyless/offline.
 * - Anthropic: messages.stream is mocked; assert text deltas are forwarded and the turn resolves to
 *   the same {final|tool_calls} shape as chatWithTools.
 * - GitHub Models: buffered fallback — global fetch stubbed; assert the whole answer is emitted as a
 *   single delta.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared stream mock, referenced inside the hoisted vi.mock factory below.
const { mockStream } = vi.hoisted(() => ({ mockStream: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAuthenticationError extends Error {}
  class MockRateLimitError extends Error {}
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, msg: string) {
      super(msg);
      this.status = status;
    }
  }
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { stream: mockStream, create: vi.fn(), parse: vi.fn() },
  }));
  (MockAnthropic as unknown as Record<string, unknown>)["AuthenticationError"] = MockAuthenticationError;
  (MockAnthropic as unknown as Record<string, unknown>)["RateLimitError"] = MockRateLimitError;
  (MockAnthropic as unknown as Record<string, unknown>)["APIError"] = MockAPIError;
  return { default: MockAnthropic };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn().mockReturnValue({ type: "json_schema" }),
}));

import { AnthropicProvider } from "../src/lib/ai/anthropicProvider.js";
import { GithubProvider } from "../src/lib/ai/githubProvider.js";

/** A fake SDK MessageStream: fires text chunks to the 'text' handler during finalMessage(). */
function fakeStream(chunks: string[], finalMessage: unknown) {
  let textCb: ((t: string) => void) | null = null;
  return {
    on(event: string, cb: (t: string) => void) {
      if (event === "text") textCb = cb;
      return this;
    },
    async finalMessage() {
      for (const c of chunks) textCb?.(c);
      return finalMessage;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnthropicProvider.chatWithToolsStream (v1.71, ADR-082)", () => {
  it("forwards text deltas and resolves to a final answer", async () => {
    mockStream.mockReturnValueOnce(
      fakeStream(["Hello ", "world"], {
        content: [{ type: "text", text: "Hello world" }],
        stop_reason: "end_turn",
      })
    );

    const provider = new AnthropicProvider("key", "claude-test");
    const deltas: string[] = [];
    const res = await provider.chatWithToolsStream(
      "system",
      [{ role: "user", content: "hi" }],
      [],
      (c) => deltas.push(c)
    );

    expect(deltas).toEqual(["Hello ", "world"]);
    expect(res).toEqual({ type: "final", text: "Hello world" });
  });

  it("resolves to tool_calls (and streams no text) when the model wants a tool", async () => {
    mockStream.mockReturnValueOnce(
      fakeStream([], {
        content: [{ type: "tool_use", id: "t1", name: "get_active_sprint", input: { sprintId: 1 } }],
        stop_reason: "tool_use",
      })
    );

    const provider = new AnthropicProvider("key", "claude-test");
    const deltas: string[] = [];
    const res = await provider.chatWithToolsStream(
      "system",
      [{ role: "user", content: "how's the sprint?" }],
      [{ name: "get_active_sprint", description: "d", parameters: {} }],
      (c) => deltas.push(c)
    );

    expect(deltas).toEqual([]);
    expect(res).toEqual({
      type: "tool_calls",
      calls: [{ id: "t1", name: "get_active_sprint", args: { sprintId: 1 } }],
    });
  });
});

describe("GithubProvider.chatWithToolsStream — buffered fallback (v1.71, ADR-082)", () => {
  it("emits the whole answer as a single delta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Buffered answer." } }] }),
      })
    );

    const provider = new GithubProvider("tok", "gpt-x", "https://models.example/v1");
    const deltas: string[] = [];
    const res = await provider.chatWithToolsStream(
      "system",
      [{ role: "user", content: "hi" }],
      [],
      (c) => deltas.push(c)
    );

    expect(deltas).toEqual(["Buffered answer."]);
    expect(res).toEqual({ type: "final", text: "Buffered answer." });
  });
});

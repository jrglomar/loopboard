/**
 * Anthropic provider for AI drafting.
 *
 * Uses the official @anthropic-ai/sdk with messages.parse + zodOutputFormat
 * (structured outputs). AI schemas import from "zod/v4" per the verified SDK snippet.
 *
 * Per contract §4.9:
 * - Never sends temperature / top_p / top_k (400 on this model family).
 * - max_tokens: 4096.
 * - Error mapping: AuthenticationError → UpstreamError; RateLimitError → UpstreamError;
 *   other APIError → message with status.
 * - Never logs the API key.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type {
  AiProvider, AiCompletion, AiToolSpec, AiToolMessage, ChatWithToolsResult,
} from "./provider.js";
import { UpstreamError } from "../errors.js";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model: string) {
    // Never log apiKey
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    _options: { maxTokens: number }
  ): Promise<AiCompletion> {
    // For the generic complete() path we use a simple text schema
    const TextSchema = z.object({ text: z.string() });

    try {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system,
        messages,
        output_config: { format: zodOutputFormat(TextSchema) },
      });

      const parsed = res.parsed_output;
      if (parsed === null || parsed === undefined) {
        throw new UpstreamError("Anthropic returned no parsed output", 500);
      }
      return { text: parsed.text };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  /**
   * Parse-based completion returning typed output directly.
   * Used by draftService for structured JSON outputs.
   */
  async parseWith<T extends z.ZodObject<z.ZodRawShape>>(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    schema: T
  ): Promise<z.output<T>> {
    try {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system,
        messages,
        output_config: { format: zodOutputFormat(schema) },
      });

      const parsed = res.parsed_output;
      if (parsed === null || parsed === undefined) {
        throw new UpstreamError("Anthropic returned no parsed output", 500);
      }
      return parsed as z.output<T>;
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  /**
   * One tool-calling turn (v1.18, ADR-029). Uses messages.create with `tools`.
   */
  async chatWithTools(
    system: string,
    messages: AiToolMessage[],
    tools: AiToolSpec[]
  ): Promise<ChatWithToolsResult> {
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system,
        messages: toAnthropicMessages(messages),
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      });

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (res.stop_reason === "tool_use" && toolUses.length > 0) {
        return {
          type: "tool_calls",
          calls: toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input })),
        };
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { type: "final", text };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  /**
   * Streaming tool-calling turn (v1.71, ADR-082). Forwards text deltas to onDelta as
   * they arrive; resolves to the same {final|tool_calls} shape as chatWithTools once the
   * message completes. Uses the SDK's messages.stream helper (finalMessage() gives the
   * assembled content incl. tool_use blocks).
   */
  async chatWithToolsStream(
    system: string,
    messages: AiToolMessage[],
    tools: AiToolSpec[],
    onDelta: (chunk: string) => void
  ): Promise<ChatWithToolsResult> {
    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 2048,
        system,
        messages: toAnthropicMessages(messages),
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      });

      // 'text' fires for text-content deltas only (never tool_use input) — safe to forward.
      stream.on("text", (delta: string) => {
        if (delta) onDelta(delta);
      });

      const res = await stream.finalMessage();

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (res.stop_reason === "tool_use" && toolUses.length > 0) {
        return {
          type: "tool_calls",
          calls: toolUses.map((b) => ({ id: b.id, name: b.name, args: b.input })),
        };
      }

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { type: "final", text };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

/**
 * Translate the normalized loop messages → Anthropic MessageParam[]. Consecutive
 * tool results are coalesced into a single user turn (the API requires all results
 * for one assistant tool_use turn to arrive together).
 */
function toAnthropicMessages(messages: AiToolMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant_tool_calls") {
      out.push({
        role: "assistant",
        content: m.calls.map((c) => ({
          type: "tool_use" as const,
          id: c.id,
          name: c.name,
          input: c.args,
        })),
      });
    } else {
      const block = {
        type: "tool_result" as const,
        tool_use_id: m.id,
        content: m.content,
      };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

function mapAnthropicError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;

  if (err instanceof Anthropic.AuthenticationError) {
    return new UpstreamError(
      "Anthropic authentication failed — check ANTHROPIC_API_KEY",
      401
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new UpstreamError(
      "Anthropic rate limit reached — retry shortly",
      429
    );
  }
  if (err instanceof Anthropic.APIError) {
    return new UpstreamError(
      `Anthropic API error (${err.status}): ${err.message}`,
      err.status ?? 500
    );
  }

  const msg = err instanceof Error ? err.message : String(err);
  return new UpstreamError(msg, 500);
}

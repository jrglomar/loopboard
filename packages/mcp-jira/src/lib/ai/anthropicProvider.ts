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
import type { AiProvider, AiCompletion } from "./provider.js";
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

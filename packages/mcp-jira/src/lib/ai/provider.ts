/**
 * AiProvider port — abstracts the two supported AI backends.
 *
 * Per contract §4.9 / ADR-006:
 * - getAiProvider() returns null when AI_PROVIDER is unset/empty.
 * - Throws ConfigError when AI_PROVIDER is set but the required key is absent.
 * - Lazy — no env reads at import time.
 */

import { getConfig } from "../config.js";
import { ConfigError } from "../errors.js";

export interface AiCompletion {
  text: string; // raw JSON text from the model
}

// ── Tool-calling (v1.18, ADR-029) — normalized across providers ────────────────

/** A function/tool the model may call (zod schema already converted to JSON Schema). */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

/** A single tool invocation the model requested. */
export interface AiToolCall {
  id: string;
  name: string;
  args: unknown;
}

/**
 * Normalized turns for the tool-calling loop, provider-agnostic. The askService
 * drives the loop in these terms; each adapter translates to/from its API shape.
 */
export type AiToolMessage =
  | { role: "user"; content: string }
  | { role: "assistant_tool_calls"; calls: AiToolCall[] }
  | { role: "tool_result"; id: string; name: string; content: string };

/** One turn's outcome: either the model answered, or it wants to call tools. */
export type ChatWithToolsResult =
  | { type: "final"; text: string }
  | { type: "tool_calls"; calls: AiToolCall[] };

export interface AiProvider {
  readonly name: "anthropic" | "github";
  readonly model: string;
  /**
   * Send a completion request.
   * system is handled separately; messages are user/assistant turns.
   * Throws UpstreamError on API failure.
   */
  complete(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options: { maxTokens: number }
  ): Promise<AiCompletion>;

  /**
   * One tool-calling turn (v1.18, ADR-029). Given the conversation so far and the
   * available tools, returns either a final answer or a set of tool calls to run.
   * Pass `tools: []` to force a final answer. Throws UpstreamError on API failure.
   */
  chatWithTools(
    system: string,
    messages: AiToolMessage[],
    tools: AiToolSpec[]
  ): Promise<ChatWithToolsResult>;

  /**
   * Streaming variant of chatWithTools (v1.71, ADR-082). Same return contract, but
   * invokes onDelta(chunk) as final-answer text arrives. When the turn resolves to
   * tool_calls instead of a final answer, onDelta may not be called at all. Anthropic
   * streams true token deltas; GitHub Models buffers and emits the whole answer once.
   * Throws UpstreamError on API failure.
   */
  chatWithToolsStream(
    system: string,
    messages: AiToolMessage[],
    tools: AiToolSpec[],
    onDelta: (chunk: string) => void
  ): Promise<ChatWithToolsResult>;
}

/**
 * Return the configured AI provider instance, or null if AI is disabled.
 * Throws ConfigError if the provider is named but its key is missing.
 * Async because it lazy-imports the concrete provider module.
 */
export async function getAiProvider(): Promise<AiProvider | null> {
  const cfg = getConfig();
  const provider = cfg.AI_PROVIDER.trim();

  if (provider === "") return null;

  if (provider === "anthropic") {
    const key = cfg.ANTHROPIC_API_KEY.trim();
    if (key === "") {
      throw new ConfigError(["ANTHROPIC_API_KEY"]);
    }
    const { AnthropicProvider } = await import("./anthropicProvider.js");
    return new AnthropicProvider(key, cfg.ANTHROPIC_MODEL);
  }

  if (provider === "github") {
    // Prefer GITHUB_MODELS_TOKEN; fall back to GITHUB_TOKEN
    const token =
      cfg.GITHUB_MODELS_TOKEN.trim() !== ""
        ? cfg.GITHUB_MODELS_TOKEN.trim()
        : (process.env["GITHUB_TOKEN"] ?? "").trim();

    if (token === "") {
      throw new ConfigError(["GITHUB_MODELS_TOKEN"]);
    }
    const { GithubProvider } = await import("./githubProvider.js");
    return new GithubProvider(
      token,
      cfg.GITHUB_MODELS_MODEL,
      cfg.GITHUB_MODELS_BASE_URL
    );
  }

  throw new ConfigError([`AI_PROVIDER (unknown value: "${provider}")`]);
}

/**
 * Read AI status from env for the health endpoint.
 * Does NOT validate key presence — just reports what is configured.
 * Safe to call even when AI is misconfigured (never throws).
 */
export function getAiStatus(): {
  enabled: boolean;
  provider: "anthropic" | "github" | null;
  model: string | null;
} {
  try {
    const cfg = getConfig();
    const provider = cfg.AI_PROVIDER.trim();

    if (provider === "anthropic") {
      return { enabled: true, provider: "anthropic", model: cfg.ANTHROPIC_MODEL };
    }
    if (provider === "github") {
      return { enabled: true, provider: "github", model: cfg.GITHUB_MODELS_MODEL };
    }
    return { enabled: false, provider: null, model: null };
  } catch {
    return { enabled: false, provider: null, model: null };
  }
}

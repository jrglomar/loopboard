/**
 * GitHub Models provider for AI drafting — raw fetch, no official SDK.
 *
 * Per contract §4.9:
 * - POST {baseUrl}/chat/completions
 * - response_format: { type: "json_object" }
 * - Parse with zod/v4 schema; on parse failure retry ONCE with re-ask message.
 * - 401/403 → UpstreamError "GitHub Models authentication failed — check ..."
 * - 404 → hint about GITHUB_MODELS_BASE_URL
 * - Never logs the token.
 */

import * as z from "zod/v4";
import type {
  AiProvider, AiCompletion, AiToolSpec, AiToolMessage, ChatWithToolsResult,
} from "./provider.js";
import { UpstreamError } from "../errors.js";

const RE_ASK_MESSAGE =
  "Your previous reply was not valid JSON matching the required schema. Reply with ONLY the JSON object.";

export class GithubProvider implements AiProvider {
  readonly name = "github" as const;
  readonly model: string;
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(token: string, model: string, baseUrl: string) {
    // Never log token
    this.token = token;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options: { maxTokens: number }
  ): Promise<AiCompletion> {
    // Free-form text (e.g. the Task Helper's Markdown). NOT JSON mode: GitHub Models rejects
    // response_format:json_object unless the messages literally contain the word "json", and
    // these callers want prose/Markdown, not a JSON object. JSON mode is completeWithSchema's job.
    const text = await this.fetchCompletion(system, messages, options.maxTokens, false);
    return { text };
  }

  /**
   * Fetch completion and parse with a zod/v4 schema (with one retry).
   * Used by draftService for structured JSON outputs.
   */
  async completeWithSchema<T extends z.ZodObject<z.ZodRawShape>>(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    schema: T
  ): Promise<z.output<T>> {
    const maxTokens = 4096;
    const text = await this.fetchCompletion(system, messages, maxTokens, true);

    // Attempt to parse
    const first = tryParse(text, schema);
    if (first !== null) return first;

    // Retry with re-ask message
    const retryMessages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: RE_ASK_MESSAGE },
    ];
    const retryText = await this.fetchCompletion(system, retryMessages, maxTokens, true);
    const second = tryParse(retryText, schema);
    if (second !== null) return second;

    throw new UpstreamError("AI returned an unparseable response", 502);
  }

  /**
   * One tool-calling turn (v1.18, ADR-029). OpenAI-style `tools` + `tool_calls`.
   */
  async chatWithTools(
    system: string,
    messages: AiToolMessage[],
    tools: AiToolSpec[]
  ): Promise<ChatWithToolsResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: "system", content: system }, ...toOpenAiMessages(messages)],
      max_tokens: 2048,
    };
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`GitHub Models request failed: ${msg}`, 502);
    }
    if (!response.ok) throw await mapGithubHttpError(response);

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new UpstreamError("GitHub Models returned non-JSON response", 502);
    }

    const message = (data as { choices?: Array<{ message?: GithubChatMessage }> })
      ?.choices?.[0]?.message;
    if (!message) {
      throw new UpstreamError("GitHub Models returned unexpected response shape", 502);
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return {
        type: "tool_calls",
        calls: message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: safeJsonParse(tc.function.arguments),
        })),
      };
    }
    return { type: "final", text: typeof message.content === "string" ? message.content : "" };
  }

  private async fetchCompletion(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    maxTokens: number,
    jsonMode: boolean
  ): Promise<string> {
    // GitHub Models (OpenAI-compatible) 400s on response_format:json_object unless the messages
    // literally contain the word "json" — guarantee it in the system prompt when in JSON mode.
    const sys = jsonMode ? ensureJsonMention(system) : system;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system" as const, content: sys },
        ...messages,
      ],
      max_tokens: maxTokens,
    };
    if (jsonMode) body.response_format = { type: "json_object" as const };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`GitHub Models request failed: ${msg}`, 502);
    }

    if (!response.ok) throw await mapGithubHttpError(response);

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new UpstreamError("GitHub Models returned non-JSON response", 502);
    }

    return extractChoiceText(data);
  }
}

/** GitHub Models requires the word "json" in the messages when response_format is json_object. */
function ensureJsonMention(system: string): string {
  return /json/i.test(system) ? system : `${system}\n\nRespond with a single JSON object.`;
}

function tryParse<T extends z.ZodObject<z.ZodRawShape>>(
  text: string,
  schema: T
): z.output<T> | null {
  try {
    const json: unknown = JSON.parse(text);
    const result = schema.safeParse(json);
    if (result.success) return result.data as z.output<T>;
    return null;
  } catch {
    return null;
  }
}

function extractChoiceText(data: unknown): string {
  if (
    data !== null &&
    typeof data === "object" &&
    "choices" in data &&
    Array.isArray((data as { choices: unknown[] }).choices) &&
    (data as { choices: unknown[] }).choices.length > 0
  ) {
    const choice = (data as { choices: unknown[] }).choices[0];
    if (
      choice !== null &&
      typeof choice === "object" &&
      "message" in (choice as object)
    ) {
      const msg = (choice as { message: unknown }).message;
      if (
        msg !== null &&
        typeof msg === "object" &&
        "content" in (msg as object)
      ) {
        const content = (msg as { content: unknown }).content;
        if (typeof content === "string") return content;
      }
    }
  }
  throw new UpstreamError("GitHub Models returned unexpected response shape", 502);
}

// ── Tool-calling helpers (v1.18, ADR-029) ──────────────────────────────────────

interface GithubChatMessage {
  content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

type OpenAiMessage =
  | { role: "user" | "system"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAiMessages(messages: AiToolMessage[]): OpenAiMessage[] {
  return messages.map((m): OpenAiMessage => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant_tool_calls") {
      return {
        role: "assistant",
        content: null,
        tool_calls: m.calls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      };
    }
    return { role: "tool", tool_call_id: m.id, content: m.content };
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function mapGithubHttpError(response: Response): Promise<UpstreamError> {
  const status = response.status;
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ").trim();
  } catch {
    /* ignore */
  }
  if (status === 401 || status === 403) {
    // Surface GitHub's actual reason. "Bad credentials" ⇒ the token is invalid/expired, NOT a
    // scope problem; a genuine scope/permission issue reads differently. Don't mislead the user.
    return new UpstreamError(
      `GitHub Models rejected the token (${status}${detail ? `: ${detail}` : ""}). ` +
        "Use a valid, unexpired GitHub token with Models access — a fine-grained PAT with the " +
        "'Models: read' account permission, or a classic PAT. Set it as GITHUB_MODELS_TOKEN.",
      status
    );
  }
  if (status === 404) {
    return new UpstreamError("GitHub Models endpoint not found — check GITHUB_MODELS_BASE_URL", 404);
  }
  return new UpstreamError(`GitHub Models error (${status}): ${detail}`, status);
}

/**
 * Per-user AI connection validation (v1.45, ADR-055). A teammate brings their OWN AI token
 * (GitHub Models PAT or an Anthropic key). We do a tiny live call at connect time so an
 * invalid/expired token or missing Models access is caught THEN, with a clear reason — not
 * later at "refine & build prompt". Never logs the token.
 */

export type AiProviderName = "anthropic" | "github";

export interface AiValidation {
  provider: AiProviderName;
  model: string;
}

const DEFAULT_MODEL: Record<AiProviderName, string> = {
  anthropic: "claude-opus-4-8",
  github: "openai/gpt-4o-mini",
};

const GITHUB_MODELS_BASE = "https://models.github.ai/inference";

/** Validate an AI token with a minimal (max_tokens: 1) live call. Throws a friendly error. */
export async function validateAi(
  provider: AiProviderName,
  token: string,
  model?: string
): Promise<AiValidation> {
  const resolvedModel = (model || "").trim() || DEFAULT_MODEL[provider];

  if (provider === "github") {
    let res: Response | null = null;
    try {
      res = await fetch(`${GITHUB_MODELS_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolvedModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      });
    } catch {
      throw new Error("Could not reach GitHub Models");
    }
    if (res.status === 401 || res.status === 403) {
      const detail = (await res.text().catch(() => "")).slice(0, 150).replace(/\s+/g, " ").trim();
      throw new Error(`GitHub rejected the token (${res.status}${detail ? `: ${detail}` : ""}) — use a valid token with Models access`);
    }
    if (!res.ok) throw new Error(`GitHub Models error (${res.status})`);
    return { provider, model: resolvedModel };
  }

  // anthropic
  let res: Response | null = null;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": token, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: resolvedModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
  } catch {
    throw new Error("Could not reach Anthropic");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Anthropic rejected the API key (${res.status})`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 150).replace(/\s+/g, " ").trim();
    throw new Error(`Anthropic error (${res.status}${detail ? `: ${detail}` : ""})`);
  }
  return { provider, model: resolvedModel };
}

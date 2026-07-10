/**
 * Task Helper AI pipeline (v1.44, ADR-054) — turns one Jira ticket into a refined spec + a
 * ready-to-paste coding-agent prompt. Reuses the existing AiProvider port (`provider.complete`);
 * the app's shared AI key is used (teammates connect Jira/GitHub, not their own AI key).
 *
 * Two personas / two calls:
 *   1. refine       — a senior engineer rewrites a vague ticket into a precise spec.
 *   2. plan+prompt  — a staff engineer plans it technically, then a prompt engineer wraps that
 *                     plan into a single coding-agent prompt.
 */

import type { AiProvider } from "./provider.js";

export interface TaskHelperInput {
  key: string;
  summary: string;
  description: string;
  issueType?: string;
  extraContext?: string; // optional repo / tech-stack notes from the user
}

export interface TaskHelperResult {
  refinedText: string;
  prompt: string;
}

const REFINE_SYSTEM = [
  "You are a senior software engineer refining a Jira ticket into a precise, unambiguous spec.",
  "Output ONLY the refined ticket as Markdown in exactly this shape:",
  "**Problem** — one short paragraph stating the problem/goal in concrete terms.",
  "**Acceptance criteria** — a bulleted, testable list.",
  "If the ticket is vague, make reasonable assumptions and list them under an **Assumptions** bullet list.",
  "No preamble, no closing remarks.",
].join("\n");

const PROMPT_SYSTEM = [
  "You are a staff software engineer AND a prompt engineer.",
  "First, privately reason through a technical plan: approach, step-by-step tasks, the files/areas likely",
  "to change, risks/edge cases, and how to test it.",
  "Then output ONE ready-to-paste prompt for an AI coding agent (e.g. Copilot, Claude Code, Cursor) that",
  "will implement the work. Output ONLY that prompt, in Markdown, with these sections:",
  "## Context — what the codebase/feature is and the goal.",
  "## Task — the concrete change to make.",
  "## Technical plan — the ordered steps (this is your plan, made explicit).",
  "## Constraints — style/patterns to follow, what NOT to change.",
  "## Acceptance criteria — testable outcomes.",
  "## Deliverables — files/tests expected.",
  "Keep it self-contained and specific. No preamble before the prompt.",
].join("\n");

function refineUser(input: TaskHelperInput): string {
  return [
    `Ticket ${input.key}${input.issueType ? ` (${input.issueType})` : ""}`,
    `Summary: ${input.summary}`,
    input.description ? `Description:\n${input.description}` : "Description: (none)",
    input.extraContext ? `Extra context from the developer:\n${input.extraContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function promptUser(input: TaskHelperInput, refinedText: string): string {
  return [
    `Refined ticket:\n${refinedText}`,
    `Original summary: ${input.summary}`,
    input.extraContext ? `Repo / tech-stack context:\n${input.extraContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runTaskHelper(
  provider: AiProvider,
  input: TaskHelperInput
): Promise<TaskHelperResult> {
  const refined = await provider.complete(REFINE_SYSTEM, [{ role: "user", content: refineUser(input) }], {
    maxTokens: 900,
  });
  const refinedText = refined.text.trim();

  const built = await provider.complete(
    PROMPT_SYSTEM,
    [{ role: "user", content: promptUser(input, refinedText) }],
    { maxTokens: 1600 }
  );

  return { refinedText, prompt: built.text.trim() };
}

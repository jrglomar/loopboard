/**
 * Admin-settable config (v1.45, ADR-055 Phase B) — the NON-secret Jira tuning block a super-admin
 * can configure globally (defaults for everyone) or per-user (overrides). Board ids, project keys,
 * link type, story-points field, code-review statuses, velocity window, offset policy, etc.
 *
 * Secrets (Jira/GitHub/AI tokens) are NEVER here — those are each user's own encrypted connection.
 *
 * The shape is a strict subset of `Config`, so a parsed value spreads straight into the merged
 * per-user Config (see userConfig.ts). Numeric fields are coerced; unknown keys are dropped.
 */

import { z } from "zod";
import type { Config } from "./config.js";

export const adminConfigSchema = z
  .object({
    JIRA_BASE_URL: z.string().url().max(300),
    JIRA_EMAIL: z.string().email().max(200),
    JIRA_PO_PROJECT_KEY: z.string().max(50),
    JIRA_DEV_PROJECT_KEY: z.string().max(50),
    JIRA_PO_BOARD_ID: z.string().min(1).max(50),
    JIRA_DEV_BOARD_ID: z.string().min(1).max(50),
    JIRA_PO_PROJECTS: z.string().max(500),
    JIRA_DEV_PROJECTS: z.string().max(500),
    JIRA_STORY_POINTS_FIELD: z.string().max(100),
    JIRA_LINK_TYPE: z.string().max(100),
    JIRA_FLAGGED_FIELD: z.string().max(100),
    JIRA_CODE_REVIEW_STATUSES: z.string().max(300),
    JIRA_DEV_STATUS_APP_TYPE: z.string().max(100),
    JIRA_VELOCITY_SPRINTS: z.coerce.number().int().positive().max(50),
    JIRA_REQUIRED_POINTS: z.coerce.number().int().nonnegative().max(1000),
    JIRA_OFFSET_THRESHOLD: z.coerce.number().int().positive().max(1000),
  })
  .partial();

/** A subset of `Config` an admin may set (global defaults or per-user overrides). */
export type AdminConfig = z.infer<typeof adminConfigSchema>;

// Compile-time guard: AdminConfig must be assignable to Partial<Config> so it spreads cleanly.
const _typecheck: Partial<Config> = {} as AdminConfig;
void _typecheck;

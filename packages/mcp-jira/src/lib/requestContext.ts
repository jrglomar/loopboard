/**
 * Request context (v1.45, ADR-055) — per-user, request-scoped config via AsyncLocalStorage.
 *
 * The bridge middleware resolves the signed-in user's merged config and runs the tool/AI
 * handler inside `runWithUser`. `getConfig()` (config.ts) reads this context first, so EVERY
 * tool + jiraClient + the AI layer transparently use that user's Jira/GitHub/AI — without
 * changing any tool. With no context (stdio/Copilot, keyless tests) getConfig() falls back to
 * the global `.env`, so the existing behavior + offline test suite are unchanged.
 */

import { AsyncLocalStorage } from "async_hooks";
import type { Config } from "./config.js";

export interface RequestContext {
  userId: string; // the REAL signed-in identity (audit)
  config: Config; // the user's fully-merged config (already resolved before entering the context)
  /**
   * v1.46 (ADR-056): where this user's per-user JSON stores live. A user on SHARED credentials
   * reads/writes the credential owner's stores, so they see the same leaves/retro/notes/offset.
   * Defaults to `userId`.
   */
  storeUserId?: string;
  /**
   * v1.46 (ADR-056): false when this user borrows someone else's Jira token and the admin has
   * NOT enabled writes — a Jira mutation would be attributed to the token's owner. Defaults true.
   */
  canWriteJira?: boolean;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given per-user context active (sync or async). */
export function runWithUser<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** The active request context, or undefined when not inside `runWithUser`. */
export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** The active user's config, or undefined (→ config.ts uses the global `.env`). */
export function getRequestConfig(): Config | undefined {
  return als.getStore()?.config;
}

/** The active user's REAL id, or undefined. */
export function getRequestUserId(): string | undefined {
  return als.getStore()?.userId;
}

/**
 * v1.46 (ADR-056): the id whose per-user store files this request should read/write. Users on
 * shared credentials point at the credential owner, so they share the team's local stores.
 */
export function getRequestStoreUserId(): string | undefined {
  const ctx = als.getStore();
  if (!ctx) return undefined;
  return ctx.storeUserId ?? ctx.userId;
}

/**
 * v1.46 (ADR-056): may this request mutate Jira? False only for a user borrowing someone else's
 * Jira token without admin-granted write access. Outside a user context (stdio/.env) → true.
 */
export function canWriteJira(): boolean {
  const ctx = als.getStore();
  if (!ctx) return true;
  return ctx.canWriteJira !== false;
}

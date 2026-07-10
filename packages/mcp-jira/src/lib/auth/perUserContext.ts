/**
 * Per-user context middleware (v1.45, ADR-055). When a request carries a valid session cookie,
 * resolve that user's merged config and run the downstream handler inside `runWithUser`, so every
 * tool / jiraClient / AI call uses the user's own Jira/GitHub/AI. AsyncLocalStorage propagates
 * across the handler's awaits.
 *
 * No session (or no Jira connection yet) → fall through unscoped: the request uses the global
 * `.env` config. This keeps the stdio/Copilot path, keyless smoke, and existing behavior working;
 * the app-wide login gate (frontend) is what actually blocks unauthenticated humans.
 */

import type { Request, Response, NextFunction } from "express";
import { currentUserId } from "./middleware.js";
import { resolveUser } from "../userConfig.js";
import { runWithUser } from "../requestContext.js";

export function perUserContext(req: Request, _res: Response, next: NextFunction): void {
  const userId = currentUserId(req);
  if (!userId) {
    next();
    return;
  }
  let resolved;
  try {
    resolved = resolveUser(userId);
  } catch {
    resolved = null;
  }
  if (!resolved) {
    next(); // authed but not connected yet — readiness is enforced by the frontend gate
    return;
  }
  // v1.46 (ADR-056): storeUserId shares the credential owner's local stores; canWriteJira is
  // false for a borrower without admin-granted write access (see the /api/tools guard).
  runWithUser(
    {
      userId,
      config: resolved.config,
      storeUserId: resolved.storeUserId,
      canWriteJira: resolved.canWriteJira,
    },
    () => next()
  );
}

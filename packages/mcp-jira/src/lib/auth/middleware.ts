/**
 * Auth middleware (v1.44, ADR-054) — reads the session cookie, verifies it, and either
 * attaches the user id or rejects with 401. Also a cookie-reading helper (no cookie-parser
 * dependency — we only ever read one cookie).
 */

import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, verifySession } from "./session.js";
import { findUserById } from "../userStore.js";

/** Parse a single cookie value out of the raw Cookie header. */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Resolve the authenticated user id from the request, or null. */
export function currentUserId(req: Request): string | null {
  return verifySession(readCookie(req, SESSION_COOKIE));
}

/**
 * Express middleware — 401 UNAUTHENTICATED unless a valid session cookie is present.
 * v1.46 (ADR-056): a disabled account is rejected even with a still-valid cookie.
 * On success sets `res.locals.userId` for the route handler.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const uid = currentUserId(req);
  if (uid === null) {
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to use the Task Helper" },
    });
    return;
  }
  const user = findUserById(uid);
  if (!user) {
    // The session points at an account that no longer exists (deleted by an admin).
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to use the Task Helper" },
    });
    return;
  }
  if (user.disabled) {
    res.status(403).json({
      ok: false,
      error: { code: "ACCOUNT_DISABLED", message: "This account has been disabled — contact an admin" },
    });
    return;
  }
  res.locals["userId"] = uid;
  next();
}

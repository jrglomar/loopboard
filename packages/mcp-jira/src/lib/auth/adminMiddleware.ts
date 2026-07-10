/**
 * Admin authorization (v1.45, ADR-055 Phase B). `requireAdmin` gates the super-admin console:
 * 401 when not signed in, 403 when signed in but not an admin. Admin = stored role "admin" OR
 * an ADMIN_EMAILS-bootstrapped email (env is authoritative for the bootstrap).
 */

import type { Request, Response, NextFunction } from "express";
import { currentUserId } from "./middleware.js";
import { findUserById, type StoredUser } from "../userStore.js";
import { isAdminEmail } from "../config.js";

/** Effective admin: promoted via the console (stored role) OR bootstrapped via ADMIN_EMAILS. */
export function isAdmin(user: StoredUser): boolean {
  return user.role === "admin" || isAdminEmail(user.email);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const uid = currentUserId(req);
  if (uid === null) {
    res.status(401).json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in" } });
    return;
  }
  const user = findUserById(uid);
  if (!user || !isAdmin(user)) {
    res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
    return;
  }
  res.locals["userId"] = uid;
  next();
}

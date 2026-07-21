/**
 * Production import-candidate scanner (v1.65, ADR-077, item 189) — everything the sqlite
 * driver needs to auto-import on its first boot. Reuses `createJsonDriver` itself (rather than
 * re-deriving path/parse logic) so "what a doc looks like today" always matches exactly what
 * the json driver would have read for that (scope, name).
 *
 * Two sources:
 *  - SHARED_SCOPE: the 11 known store names, honoring each store's `*_FILE` override exactly
 *    like production reads do (via registry.ts).
 *  - Per-user: every subdirectory of `userStoresDir` is a user id (scope); every `*.json`
 *    file inside it is a doc (name = the filename without `.json`) — found by directory scan
 *    rather than a hardcoded list, so it picks up all 10 per-user "team" stores AND `journal`
 *    (which has no shared-scope entry) without needing to enumerate them by hand.
 *
 * `userStoresDir` defaults to config.ts's real `USER_STORES_DIR` (production) but is
 * overridable so tests can point it at a temp dir instead of scanning a developer's real
 * `.invokeboard-user-stores/` (which may hold real per-user data on a dev machine).
 */

import * as fs from "fs";
import * as path from "path";
import { USER_STORES_DIR } from "../config.js";
import { createJsonDriver } from "./jsonDriver.js";
import { SHARED_SCOPE } from "./port.js";
import type { JsonDocRef } from "./sqliteDriver.js";
import { SHARED_STORE_NAMES, resolveJsonOverride } from "./registry.js";

export interface LoadJsonImportCandidatesOptions {
  userStoresDir?: string;
}

export function loadJsonImportCandidates(opts: LoadJsonImportCandidatesOptions = {}): JsonDocRef[] {
  const userStoresDir = opts.userStoresDir ?? USER_STORES_DIR;
  const jsonDriver = createJsonDriver({ resolveOverride: resolveJsonOverride, userStoresDir });
  const out: JsonDocRef[] = [];

  for (const name of SHARED_STORE_NAMES) {
    const data = jsonDriver.readDoc(SHARED_SCOPE, name);
    if (data !== null) out.push({ scope: SHARED_SCOPE, name, data });
  }

  let userDirs: fs.Dirent[] = [];
  try {
    userDirs = fs.readdirSync(userStoresDir, { withFileTypes: true });
  } catch {
    userDirs = []; // no per-user stores dir yet — nothing to scan
  }

  for (const entry of userDirs) {
    if (!entry.isDirectory()) continue;
    const userId = entry.name;
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(userStoresDir, userId));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const name = file.slice(0, -".json".length);
      const data = jsonDriver.readDoc(userId, name);
      if (data !== null) out.push({ scope: userId, name, data });
    }
  }

  return out;
}

/**
 * JSON storage driver (v1.65, ADR-077) — the default driver (`STORAGE_DRIVER=json`), and the
 * dev-default behavior every store had before the storage port existed. Byte-identical to the
 * pre-port code: same file paths (per-store `*_FILE` overrides + `USER_STORES_DIR`-scoped
 * per-user paths), same tolerant-read-returns-null semantics, same crash-atomic writes via the
 * shared `writeJsonAtomic` helper.
 *
 * Path resolution for a doc (scope, name):
 *  - scope !== SHARED_SCOPE (a per-user id) → `<userStoresDir>/<scope>/<name>.json` — this is
 *    the exact `resolveStorePath` per-user branch from config.ts, generalized: every existing
 *    per-user basename ("leaves.json", "team.json", …, "journal.json") already follows
 *    `<name>.json`, so this formula reproduces them precisely.
 *  - scope === SHARED_SCOPE → the store's `*_FILE` override if the caller supplies one via
 *    `resolveOverride(name)` (production wiring — see storage/registry.ts), else
 *    `<baseDir>/.invokeboard-<name>.json` — which is exactly each store's DEFAULT_*_FILE
 *    constant in config.ts (e.g. name="post-scrum" → ".invokeboard-post-scrum.json").
 *
 * Defaults for `baseDir`/`userStoresDir` are derived from config.ts's own `USER_STORES_DIR`
 * (not recomputed independently) so production behavior can never drift from it — tests that
 * poke `USER_STORES_DIR` directly (e.g. journal.test.ts, requestContext.test.ts) keep working
 * unchanged. Tests that want isolation from the real package dir pass both options explicitly.
 */

import * as fs from "fs";
import * as path from "path";
import { writeJsonAtomic } from "../atomicFile.js";
import { USER_STORES_DIR } from "../config.js";
import { SHARED_SCOPE, type StorageDriver } from "./port.js";

export interface JsonDriverOptions {
  /** Base dir for shared-scope default paths. Default: the mcp-jira package dir (= dirname of USER_STORES_DIR). */
  baseDir?: string;
  /** Base dir for per-user scope paths. Default: config.ts's USER_STORES_DIR. */
  userStoresDir?: string;
  /** Per-name override lookup, consulted for shared-scope docs only. "" / omitted = no override. */
  resolveOverride?: (name: string) => string;
}

export function createJsonDriver(opts: JsonDriverOptions = {}): StorageDriver {
  const baseDir = opts.baseDir ?? path.dirname(USER_STORES_DIR);
  const userStoresDir = opts.userStoresDir ?? USER_STORES_DIR;
  const resolveOverride = opts.resolveOverride ?? ((): string => "");

  function pathFor(scope: string, name: string): string {
    if (scope !== SHARED_SCOPE) return path.join(userStoresDir, scope, `${name}.json`);
    return resolveOverride(name) || path.join(baseDir, `.invokeboard-${name}.json`);
  }

  return {
    readDoc(scope: string, name: string): unknown {
      try {
        const raw = fs.readFileSync(pathFor(scope, name), "utf8");
        return JSON.parse(raw) as unknown;
      } catch {
        // ENOENT, JSON.parse error, permission error → "no doc" (mirrors every store's
        // pre-port try/catch-returns-empty read path).
        return null;
      }
    },
    writeDoc(scope: string, name: string, data: unknown): void {
      const filePath = pathFor(scope, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeJsonAtomic(filePath, data);
    },
  };
}

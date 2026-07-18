/**
 * Crash-atomic JSON file writes — shared by every §4/§8 host-local JSON store
 * (leaves, team, impediments, prs, post-scrum, meeting-goal, offset, meeting-notes,
 * retro, journal, users).
 *
 * v1.63 (ADR-075): a plain `fs.writeFileSync` can be interrupted mid-write (crash,
 * power loss, container kill) and leave a truncated/corrupt file behind — the next
 * read then silently falls back to `{}` (or throws), losing everything already
 * banked. `writeJsonAtomic` writes to a same-directory `<file>.tmp` first, then
 * `fs.renameSync`s it over the target. `rename(2)` is atomic on the same
 * filesystem, so a reader racing the write always sees either the complete old
 * file or the complete new one — never a partial write. A stale `.tmp` left behind
 * by a crash between the write and the rename is harmless leftover (ignored by
 * every store's read path, which only ever opens the real filename).
 */

import * as fs from "fs";

// On Windows, a virus scanner or indexer can hold a just-created file open for a
// few milliseconds, making the rename throw a transient EPERM/EACCES (the reason
// graceful-fs exists). POSIX targets never hit this. Retry a handful of times with
// a tiny spin-wait; anything persistent (or any other error) still throws.
const RENAME_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = 5;

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES";
      if (!transient || attempt >= RENAME_ATTEMPTS) throw err;
      const until = Date.now() + RENAME_BACKOFF_MS;
      while (Date.now() < until) {
        // sync spin — the API is synchronous and the lock window is ms-scale
      }
    }
  }
}

/**
 * Serialize `data` as pretty-printed JSON and write it to `filePath` atomically.
 * Caller is responsible for ensuring the parent directory exists (stores already
 * `mkdirSync(..., { recursive: true })` before calling this).
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameWithRetry(tmp, filePath);
}

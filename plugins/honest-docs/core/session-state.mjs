// The hooks' session state: <stateDir>/honest-docs-<session_id>.json.
//
//   {
//     "version": 1,
//     "session_id": "<claude session id>",
//     "updated_at": "<ISO 8601>",
//     "verified": { "<path>": "<blob sha>" },   // passed the guard in exactly this content
//     "gaveUp":   { "<path>": "<blob sha>" },   // the gate conceded on exactly this content
//     "failure":  { "fingerprint": "<sha>", "repeats": 2, "check": "<name>" }, // the run of identical failures so far
//     "treeSnapshot": { "<path>": "<blob sha>" | null }, // git status at the last doc check; null = deleted, absent = as in HEAD
//     "docReminders": { "<doc>": "reminded" | "edited" } // docs that stay quiet for the rest of the session
//   }
//
// Paths are repo-relative and POSIX; the hash is `git hash-object` over what is on disk. Both maps
// are keyed by content, not by path alone: an entry stops applying the moment the file changes
// again, which is what lets a conceded file come back under the gate once someone edits it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const sessionKey = (id) => String(id ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';

/** read / update / write of one session's state file. */
export function sessionStore(root, config, session) {
  const target = path.join(root, config.stateDir, `honest-docs-${session}.json`);

  /** The stored state, or null when there is none to read — the two are different to the baseline. */
  function read() {
    try {
      const state = JSON.parse(readFileSync(target, 'utf8'));
      if (state?.version === 1) return { verified: {}, gaveUp: {}, ...state };
    } catch {
      // No state yet, or one written by an older format.
    }
    return null;
  }

  function write(state) {
    const payload = { ...state, version: 1, session_id: session, updated_at: new Date().toISOString() };

    mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(tmp, target);
  }

  /**
   * Merges fields into the state as it is on disk now. Hooks on the same PostToolUse event run in
   * parallel, so a state read at the start of a hook may be stale by the time it writes.
   */
  function update(fields) {
    write({ verified: {}, gaveUp: {}, ...read(), ...fields });
  }

  return { path: target, read, write, update };
}

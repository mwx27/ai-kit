// The hooks' session state: a folder per session, <stateDir>/sessions/<session_id>/. SessionStart
// removes the folders of sessions untouched for SESSION_MAX_AGE_MS (removeOldSessions).
//
//   state.json        the gate's and the reminder's state, below
//   start.json        the docs problems there were when the session started (core/problems.mjs)
//   attributed.jsonl  the paths the session's tool calls changed (core/attribution.mjs)
//   pre/<id>.json     a Bash call's tree before it ran, until its Post hook reads it
//
// state.json:
//   {
//     "version": 2,
//     "session_id": "<claude session id>",
//     "updated_at": "<ISO 8601>",
//     "verified": { "<path>": "<blob sha>" | null }, // passed the checks in exactly this content; null = as deleted
//     "gaveUp":   { "<path>": "<blob sha>" | null }, // the gate conceded on exactly this content
//     "failure":  { "fingerprint": "<sha>", "repeats": 2, "check": "<name>" }, // the run of identical failures so far
//     "docReminders": { "<doc>": "reminded" | "edited" }, // docs the covers reminder leaves alone from now on
//     "problemNotes": { "<doc>": <count> } // docs whose problems from before the session were named once
//   }
//
// start.json:
//   { "version": "<code version>", "taken_at": "<ISO 8601>", "taken_by": "session-start" | "stop",
//     "problems": [{ "check", "file", "message", "count" }] }
//
// Paths are repo-relative and POSIX; the hash is `git hash-object` over what is on disk. Both maps
// are keyed by content, not by path alone: an entry stops applying the moment the file changes
// again, which is what lets a conceded file come back under the gate once someone edits it.
//
// A folder with a new name, so the 0.1.x gate, which reads honest-docs-<id>.json with version 1,
// never meets this one.
import { readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeDir } from './state-dir.mjs';

export const sessionKey = (id) => String(id ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';

/** <root>/<stateDir>/sessions/ */
export const sessionsDir = (root, config) => path.join(root, config.stateDir, 'sessions');

/** <root>/<stateDir>/sessions/<session>/ */
export const sessionDir = (root, config, session) => path.join(sessionsDir(root, config), session);

/**
 * A session's folder is removed once nothing in it has changed for this long. A session resumed
 * after that starts without a start set, which the first Stop takes without blocking (core/gate.mjs).
 */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The newest mtime in `dir`, the folder itself and everything under it included. */
function newestChange(dir) {
  let newest = statSync(dir).mtimeMs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(full) : statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * Removes the session folders in `parent` (sessionsDir) whose newest change is older than `maxAge`,
 * except `keep`, and returns how many went. Never throws: a folder another session holds open
 * (Windows: EBUSY) stays for the next SessionStart.
 */
export function removeOldSessions(parent, keep, maxAge = SESSION_MAX_AGE_MS, now = Date.now()) {
  let entries = [];
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keep) continue;
    const dir = path.join(parent, entry.name);
    try {
      if (now - newestChange(dir) <= maxAge) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      removed++;
    } catch {
      // Held open or gone already; the next SessionStart tries again.
    }
  }
  return removed;
}

/** Writes `text` through a tmp file and a rename, so a reader never sees half of it. */
export function writeAtomic(file, text) {
  makeDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** read / update / write of one session's state.json. */
export function sessionStore(dir, session) {
  const target = path.join(dir, 'state.json');

  /** The stored state, or null when there is none to read. */
  function read() {
    const state = readJson(target);
    return state?.version === 2 ? { verified: {}, gaveUp: {}, ...state } : null;
  }

  function write(state) {
    writeAtomic(target, `${JSON.stringify({ ...state, version: 2, session_id: session, updated_at: new Date().toISOString() }, null, 2)}\n`);
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

/** The start set, or null when there is none (or none that can be read). */
export function readStartSet(dir) {
  const start = readJson(path.join(dir, 'start.json'));
  return typeof start?.version === 'string' && Array.isArray(start.problems) ? start : null;
}

/** Stores `problems` (countByKey's values) as the start set taken by `takenBy` with code `version`. */
export function writeStartSet(dir, { version, takenBy, problems }) {
  const start = { version, taken_at: new Date().toISOString(), taken_by: takenBy, problems };
  writeAtomic(path.join(dir, 'start.json'), `${JSON.stringify(start, null, 2)}\n`);
}

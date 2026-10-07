// Session baseline: records the dirt that was already there as verified, so the guard gate only
// ever blocks on what this session did. It also records the tree snapshot, so the doc reminder
// never fires on work that predates the session.
//
// Without it the gate reads the whole working tree as the agent's work: a user who starts a session
// mid-WIP would have their own unfinished files fail the guard and block the agent's first turn.
//
// It writes the baseline exactly once. A resume, a /clear or a compaction fires SessionStart again
// with the same session id, and re-baselining there would silently mark everything the agent had
// already broken as fine.
import { treeSnapshot } from './changed-files.mjs';
import { loadConfig, ownDirs } from './config.mjs';
import { logEvent } from './log.mjs';
import { sessionKey, sessionStore } from './session-state.mjs';

/** Hook input → { exitCode }. Always exit 0. */
export function baseline(input) {
  if (!input) return { exitCode: 0 };
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = loadConfig(root);
  const store = sessionStore(root, config, sessionKey(input.session_id));

  if (store.read() !== null) {
    logEvent(root, 'baseline', { written: false, source: input.source });
    return { exitCode: 0 };
  }

  const snapshot = treeSnapshot(root, ownDirs(config));
  if (snapshot) {
    const verified = Object.fromEntries(Object.entries(snapshot).filter(([, hash]) => hash !== null));
    store.write({ verified, gaveUp: {}, treeSnapshot: snapshot });
    logEvent(root, 'baseline', { written: true, source: input.source, dirty: Object.keys(snapshot).length });
  }
  return { exitCode: 0 };
}

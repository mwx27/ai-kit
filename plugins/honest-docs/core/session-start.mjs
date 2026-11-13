// SessionStart: takes the start set — the docs problems there are before the session does anything
// (core/problems.mjs) — and tells the model how many there are.
//
// The start set is written once per session id. A resume, a /clear or a compaction fires
// SessionStart again with the same id, and taking it again there would turn what the session
// already broke into problems from before it. The line is printed every time: the model's earlier
// context may be gone. Plain stdout from SessionStart is added to the model's context (hooks docs).
import { mkdirSync } from 'node:fs';
import { ConfigError, loadConfig } from './config.mjs';
import { logEvent, pluginVersion } from './log.mjs';
import { countByKey, docsCheckCommand, runDocsCheck } from './problems.mjs';
import { hookRoot } from './root.mjs';
import { readStartSet, sessionDir, sessionKey, writeStartSet } from './session-state.mjs';

// Within the hook's 15 s in hooks/hooks.json.
const DOCS_CHECK_TIMEOUT_MS = 12_000;

/** Hook input → { stdout, exitCode }. Always exit 0. */
export function sessionStart(input) {
  if (!input) return { exitCode: 0 };
  const root = hookRoot(input);
  if (root === null) return { exitCode: 0 };
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // Silent: the Stop gate reports a broken config, once per turn.
    logEvent(root, 'session-start', { source: input.source, reason: 'config-error' });
    return { exitCode: 0 };
  }
  const dir = sessionDir(root, config, sessionKey(input.session_id));
  mkdirSync(dir, { recursive: true });

  const { problems, error } = runDocsCheck(root, DOCS_CHECK_TIMEOUT_MS);
  if (error) {
    // No start set: the first Stop takes one and does not block on the docs.
    logEvent(root, 'session-start', { source: input.source, reason: error });
    return { exitCode: 0 };
  }
  const written = readStartSet(dir) === null;
  if (written) writeStartSet(dir, { version: pluginVersion(), takenBy: 'session-start', problems: countByKey(problems) });
  logEvent(root, 'session-start', { source: input.source, written, problems: problems.length });

  if (problems.length === 0) return { exitCode: 0 };
  return {
    stdout: `honest-docs: ${problems.length} docs problem${problems.length === 1 ? '' : 's'} in this repo (not blocking); list them with ${docsCheckCommand()}\n`,
    exitCode: 0,
  };
}

// One shared event log: <logDir>/events.jsonl in the project, a JSON object per line.
//
//   { "ts", "event", "pluginVersion", "project", "pluginRoot", ...metadata }
//
// Metadata only — rule names, outcomes, counts, timings — never the content of a file or a prompt,
// so the same record can later be sent elsewhere unchanged. `project` is the basename of the root.
// `pluginVersion` is the version of the running code (core/version.mjs: the copy's manifest, or the
// plugin's plugin.json); `pluginRoot` shows which copy of the code wrote the line.
//
// Only a process a hook started writes: hooks/io.mjs sets HONEST_DOCS_HOOK=1, and what the hook
// spawns (docs-check, the guard) inherits it. A script run from a terminal, CI or the agent's Bash
// writes nothing. A config that cannot be read sends the line to the default logDir. It never throws.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOG_DIR, loadConfig } from './config.mjs';
import { makeDir } from './state-dir.mjs';
import { installedVersion } from './version.mjs';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let version;
/** The running code's version; throws naming the files when its root has neither (core/version.mjs). */
export function pluginVersion() {
  version ??= installedVersion(PLUGIN_ROOT);
  return version;
}

export function logEvent(root, event, fields = {}) {
  if (process.env.HONEST_DOCS_HOOK !== '1') return;
  try {
    let logDir = DEFAULT_LOG_DIR;
    try {
      logDir = loadConfig(root).logDir;
    } catch {
      // A broken config is what some events report; they still need somewhere to go.
    }
    const dir = path.join(root, logDir);
    makeDir(dir);
    const record = {
      ts: new Date().toISOString(),
      event,
      pluginVersion: pluginVersion(),
      project: path.basename(root),
      pluginRoot: PLUGIN_ROOT,
      ...fields,
    };
    appendFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify(record)}\n`);
  } catch {
    // A log that breaks what it records is worse than no log.
  }
}

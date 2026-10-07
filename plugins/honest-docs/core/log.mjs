// One shared event log: ${CLAUDE_PLUGIN_DATA}/events.jsonl, a JSON object per line.
//
//   { "ts", "event", "pluginVersion", "project", "pluginRoot", ...metadata }
//
// Metadata only — rule names, outcomes, counts, timings — never the content of a file or a prompt,
// so the same record can later be sent elsewhere unchanged. `project` is the basename of the root.
// `pluginRoot` is for local use: it shows which installed copy of the plugin wrote the line.
//
// CLAUDE_PLUGIN_DATA is set for hooks and whatever they spawn, not for a script run from Bash; there
// the call does nothing. It never throws.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let version;
export function pluginVersion() {
  if (version === undefined) {
    try {
      version = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    } catch {
      version = null;
    }
  }
  return version;
}

export function logEvent(root, event, fields = {}) {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
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

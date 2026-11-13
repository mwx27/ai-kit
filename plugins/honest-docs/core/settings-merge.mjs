// The hooks /honest-docs:init and /honest-docs:update merge into the project's .claude/settings.json
// (core/install.mjs), and how.
//
// Each runs a script of the copy in exec form — "command": "node", "args":
// ["${CLAUDE_PROJECT_DIR}/.claude/honest-docs/hooks/<x>.mjs"] — with the events, matchers and
// timeouts of the plugin's own hooks/hooks.json.
//
// A handler is ours when an `args` element, or the `command` string, names the copy's folder under
// ${CLAUDE_PROJECT_DIR} or $CLAUDE_PROJECT_DIR; it is matched to what honest-docs writes by event,
// matcher and script. The manifest keeps what the last install wrote:
//   - a handler equal to it is replaced by the current one, or removed when the current set has none;
//   - one that differs from it (edited by hand), or that is gone (removed by hand), is left as it
//     is, with a `next:` line;
//   - with nothing recorded (init, or a hook new in this version), a missing handler is appended as
//     a group of its own, and one already there that differs counts as edited by hand.
// Every other hook and key stays where it is.
import { COPY_DIR } from './config.mjs';

export const SETTINGS_FILE = '.claude/settings.json';

/** [event, matcher, script under the copy, timeout] — as in hooks/hooks.json. */
const HOOK_SET = [
  ['SessionStart', null, 'hooks/session-start.mjs', 15],
  ['PreToolUse', 'Bash', 'hooks/pre-tool.mjs', 10],
  ['PostToolUse', 'Edit|Write|NotebookEdit|Bash', 'hooks/post-tool.mjs', 10],
  ['PostToolUse', 'Edit|Write|Skill|Read', 'hooks/instructions-log.mjs', 5],
  ['PostToolUseFailure', 'Bash', 'hooks/post-tool.mjs', 10],
  ['Stop', null, 'hooks/stop-gate.mjs', 180],
  ['InstructionsLoaded', null, 'hooks/instructions-log.mjs', 5],
  ['UserPromptExpansion', null, 'hooks/instructions-log.mjs', 5],
];

/** The `hooks` object honest-docs writes, in settings.json's shape. */
export function copyHooks() {
  const hooks = {};
  for (const [event, matcher, script, timeout] of HOOK_SET) {
    const handler = { type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/${COPY_DIR}/${script}`], timeout };
    (hooks[event] ??= []).push({ ...(matcher ? { matcher } : {}), hooks: [handler] });
  }
  return hooks;
}

const OURS = new RegExp(`\\$\\{?CLAUDE_PROJECT_DIR\\}?/${COPY_DIR.replace(/[.]/g, '\\.')}/([^\\s"']+)`);

/** The copy's script a handler runs (`hooks/stop-gate.mjs`), or null for a handler not ours. */
export function scriptOf(handler) {
  for (const text of [...(Array.isArray(handler?.args) ? handler.args : []), handler?.command]) {
    const match = typeof text === 'string' && text.match(OURS);
    if (match) return match[1];
  }
  return null;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** JSON with keys sorted: two handlers are the same when this is. */
const canonical = (value) =>
  JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

const keyOf = (event, matcher, script) => JSON.stringify([event, matcher ?? '', script]);

/** hooks object → Map of key → handler, for ours only. */
function handlersOf(hooks) {
  const map = new Map();
  for (const [event, groups] of Object.entries(isObject(hooks) ? hooks : {}))
    for (const group of Array.isArray(groups) ? groups : [])
      for (const handler of Array.isArray(group?.hooks) ? group.hooks : []) {
        const script = scriptOf(handler);
        if (script) map.set(keyOf(event, group.matcher, script), handler);
      }
  return map;
}

/** A settings.json the merge cannot work on. */
export class SettingsError extends Error {}

/**
 * Merges `next` (copyHooks()) into `settings`, given `previous`, the hooks the last install wrote
 * (null for none). Returns `{ settings, changed, nexts }`; `settings` is a new object, `changed`
 * whether its content differs, `nexts` the lines for hooks left as the user has them.
 */
export function mergeHooks(settings, { previous, next, version }) {
  if (settings.hooks !== undefined && !isObject(settings.hooks)) throw new SettingsError(`${SETTINGS_FILE}: "hooks" is not an object`);
  const merged = structuredClone(settings);
  const hooks = (merged.hooks ??= {});
  for (const [event, groups] of Object.entries(hooks))
    if (!Array.isArray(groups)) throw new SettingsError(`${SETTINGS_FILE}: hooks.${event} is not an array`);

  const was = handlersOf(previous);
  const want = handlersOf(next);
  const nexts = [];
  const seen = new Set();
  const label = (event, matcher, script) => `${SETTINGS_FILE}: ${event}${matcher ? ` (${matcher})` : ''} hook ${script}`;

  for (const [event, groups] of Object.entries(hooks)) {
    // Only a group or event this merge empties goes: one the user left empty is theirs.
    const emptied = new Set();
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.flatMap((handler) => {
        const script = scriptOf(handler);
        if (!script) return [handler];
        const key = keyOf(event, group.matcher, script);
        seen.add(key);
        const now = want.get(key);
        if (now && canonical(handler) === canonical(now)) return [handler];
        if (was.has(key) && canonical(handler) === canonical(was.get(key))) return now ? [structuredClone(now)] : [];
        nexts.push(
          `${label(event, group.matcher, script)} differs from what honest-docs ${version} writes: ` +
            `found ${canonical(handler)}, honest-docs writes ${now ? canonical(now) : 'nothing'}; merge it by hand`
        );
        return [handler];
      });
      if (before > 0 && group.hooks.length === 0) emptied.add(group);
    }
    if (emptied.size === 0) continue;
    hooks[event] = groups.filter((group) => !emptied.has(group));
    if (hooks[event].length === 0) delete hooks[event];
  }

  for (const [event, groups] of Object.entries(next)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        const key = keyOf(event, group.matcher, scriptOf(handler));
        if (seen.has(key)) continue;
        if (was.has(key)) {
          nexts.push(
            `${label(event, group.matcher, scriptOf(handler))} was removed by hand, so honest-docs ${version} left it out; ` +
              `tell the user it is off: ${canonical(handler)}`
          );
          continue;
        }
        (hooks[event] ??= []).push({ ...(group.matcher ? { matcher: group.matcher } : {}), hooks: [structuredClone(handler)] });
      }
    }
  }

  return { settings: merged, changed: JSON.stringify(merged) !== JSON.stringify(settings), nexts };
}

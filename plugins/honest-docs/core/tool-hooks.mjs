// The tool-call hooks: PreToolUse on Bash stores the tree; PostToolUse on Edit|Write|NotebookEdit|Bash
// and PostToolUseFailure on Bash attribute the call's paths to the session (core/attribution.mjs),
// then run the doc reminder on them (core/reminder.mjs). Both always exit 0.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { diffSnapshots, putPre, recordPaths, takePre, toolPath } from './attribution.mjs';
import { treeSnapshot } from './changed-files.mjs';
import { ConfigError, loadConfig, ownDirs } from './config.mjs';
import { logEvent } from './log.mjs';
import { docReminder } from './reminder.mjs';
import { hookRoot } from './root.mjs';
import { readStartSet, sessionDir, sessionKey, sessionStore } from './session-state.mjs';

/** Hook input → { root, config, dir, session }, or null when the hook has nothing to do. */
function setup(input, event) {
  if (!input) return null;
  const root = hookRoot(input);
  if (root === null) return null;
  try {
    const config = loadConfig(root);
    const session = sessionKey(input.session_id);
    return { root, config, session, dir: sessionDir(root, config, session) };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // Silent: the Stop gate reports a broken config, once per turn.
    logEvent(root, event, { reason: 'config-error' });
    return null;
  }
}

/** PreToolUse (Bash): the dirty tree before the call, under its tool_use_id. */
export function preTool(input) {
  const ctx = setup(input, 'attribution');
  if (!ctx || input.tool_name !== 'Bash' || !input.tool_use_id) return { exitCode: 0 };
  const snapshot = treeSnapshot(ctx.root, ownDirs(ctx.config));
  // Without git there is nothing to compare, and the Post then records nothing.
  if (snapshot) putPre(ctx.dir, input.tool_use_id, snapshot);
  return { exitCode: 0 };
}

/** The paths the call changed, as { path, deleted }, or null when it cannot be told. */
function changedBy(ctx, input) {
  if (input.tool_name === 'Bash') {
    const pre = input.tool_use_id ? takePre(ctx.dir, input.tool_use_id) : null;
    if (pre === null) {
      logEvent(ctx.root, 'attribution', { tool: 'Bash', reason: 'no-pre' });
      return null;
    }
    const post = treeSnapshot(ctx.root, ownDirs(ctx.config));
    return post && diffSnapshots(ctx.root, pre, post);
  }
  const file = toolPath(ctx.root, ctx.config, input);
  return file === null ? [] : [{ path: file, deleted: !existsSync(path.join(ctx.root, file)) }];
}

/** PostToolUse (Edit|Write|NotebookEdit|Bash) and PostToolUseFailure (Bash). */
export function postTool(input) {
  const ctx = setup(input, 'attribution');
  if (!ctx) return { exitCode: 0 };
  const entries = changedBy(ctx, input);
  if (!entries || entries.length === 0) return { exitCode: 0 };

  recordPaths(ctx.dir, { by: input.tool_name, id: input.tool_use_id ?? null, entries });
  logEvent(ctx.root, 'attribution', { tool: input.tool_name, paths: entries.length });

  const stdout = docReminder({
    root: ctx.root,
    config: ctx.config,
    store: sessionStore(ctx.dir, ctx.session),
    tool: input.tool_name,
    eventName: input.hook_event_name ?? 'PostToolUse',
    entries,
    startSet: readStartSet(ctx.dir),
  });
  return { stdout, exitCode: 0 };
}

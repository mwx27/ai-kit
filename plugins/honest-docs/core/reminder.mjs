// Doc reminder: tells Claude to check a doc when code the doc lists in `covers:` changed.
//
// Runs after Edit|Write|Bash. One rule for every tool, and the Bash command is never parsed: git
// status (core/changed-files.mjs) is compared with the snapshot stored in the session state, and a
// file whose hash moved since the last check counts as changed — deleted included. A changed doc
// goes quiet for the rest of the session; so does a doc once reminded. It reminds and never blocks.
import { treeSnapshot } from './changed-files.mjs';
import { loadConfig, ownDirs } from './config.mjs';
import { isDoc, readCovers } from './doc-covers.mjs';
import { logEvent } from './log.mjs';
import { sessionKey, sessionStore } from './session-state.mjs';

const AS_IN_HEAD = Symbol('as in HEAD');
const valueOf = (snapshot, file) => (Object.hasOwn(snapshot, file) ? snapshot[file] : AS_IN_HEAD);

/** Files whose state moved since the stored snapshot, except those that went back to HEAD. */
function movedFiles(stored, current) {
  return Object.keys(current).filter((file) => valueOf(stored, file) !== current[file]);
}

function message(due, current) {
  const describe = (file) => (current[file] === null ? `${file} (deleted)` : file);
  const lines = [...due].map(([doc, files]) => `${files.map(describe).join(', ')} → ${doc}`);

  return JSON.stringify({
    systemMessage: `docs: check ${[...due.keys()].join(', ')}`,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `Code a doc lists in its \`covers:\` frontmatter changed:\n${lines.join('\n')}\n` +
        `Open each doc with the Read tool and check whether any sentence is now false; edit it only ` +
        `if one is. This is not a request to add content. Each doc is named once per session.`,
    },
  });
}

/** Hook input → { stdout, exitCode }. Always exit 0. */
export function reminder(input) {
  if (!input) return { exitCode: 0 };
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const config = loadConfig(root);
  const store = sessionStore(root, config, sessionKey(input.session_id));

  const state = store.read();
  const current = treeSnapshot(root, ownDirs(config));
  if (!state || !current) return { exitCode: 0 };

  // A session whose baseline predates the snapshot starts it here, silently.
  if (!state.treeSnapshot) {
    store.update({ treeSnapshot: current });
    return { exitCode: 0 };
  }

  const moved = movedFiles(state.treeSnapshot, current);
  if (moved.length === 0) return { exitCode: 0 };

  const docsDir = config.docsDir;
  const reminders = { ...state.docReminders };
  for (const file of moved.filter((file) => isDoc(file, docsDir))) reminders[file] = 'edited';

  const due = new Map();
  for (const { doc, patterns } of readCovers(root, docsDir)) {
    if (reminders[doc]) continue;
    const files = moved.filter((file) => !isDoc(file, docsDir) && patterns.some((re) => re.test(file)));
    if (files.length === 0) continue;
    due.set(doc, files);
    reminders[doc] = 'reminded';
  }

  store.update({ treeSnapshot: current, docReminders: reminders });
  if (due.size === 0) return { exitCode: 0 };

  logEvent(root, 'reminder', { docs: due.size, files: new Set([...due.values()].flat()).size });
  return { stdout: message(due, current), exitCode: 0 };
}

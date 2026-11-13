// Doc reminder: tells Claude to check a doc when code the doc lists in `covers:` changed, and names
// how many docs problems a doc it touched had before the session.
//
// Runs on the paths a tool call was just attributed (core/tool-hooks.mjs), so the user's editor
// edits and other sessions' work never trigger it. A changed doc goes quiet for the rest of the
// session; so does a doc once reminded. The count of problems from before the session is said once
// per doc, when the reminder names the doc or an Edit or Write touches it. It reminds and never blocks.
import { isDoc, readCovers } from './doc-covers.mjs';
import { logEvent } from './log.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function message(eventName, due, notes) {
  const describe = ({ path: file, deleted }) => (deleted ? `${file} (deleted)` : file);
  const context = [];
  if (due.size > 0) {
    const lines = [...due].map(([doc, entries]) => `${entries.map(describe).join(', ')} → ${doc}`);
    context.push(
      `Code a doc lists in its \`covers:\` frontmatter changed:\n${lines.join('\n')}\n` +
        `Open each doc with the Read tool and check whether any sentence is now false; edit it only ` +
        `if one is. This is not a request to add content. Each doc is named once per session.`
    );
  }
  // Not blocking, and said as a count only: the line is for context, not a request to fix them.
  if (notes.length > 0)
    context.push(notes.map(([doc, count]) => `${doc} has ${count} docs problem${count === 1 ? '' : 's'} from before this session`).join('\n'));

  return JSON.stringify({
    ...(due.size > 0 ? { systemMessage: `docs: check ${[...due.keys()].join(', ')}` } : {}),
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context.join('\n\n') },
  });
}

/**
 * The reminder for `entries` ({ path, deleted }) just attributed to tool `tool`: stdout, or '' when
 * there is nothing to say. `startSet` is the session's (core/session-state.mjs), or null.
 */
export function docReminder({ root, config, store, tool, eventName, entries, startSet }) {
  const state = store.read() ?? {};
  const reminders = { ...state.docReminders };
  const notes = { ...state.problemNotes };
  const docsDir = config.docsDir;
  for (const { path: file } of entries.filter(({ path: file }) => isDoc(file, docsDir))) reminders[file] = 'edited';

  const due = new Map();
  for (const { doc, patterns } of readCovers(root, config)) {
    if (reminders[doc]) continue;
    const files = entries.filter(({ path: file }) => !isDoc(file, docsDir) && patterns.some((re) => re.test(file)));
    if (files.length === 0) continue;
    due.set(doc, files);
    reminders[doc] = 'reminded';
  }

  const before = new Map();
  for (const { file, count } of startSet?.problems ?? []) before.set(file, (before.get(file) ?? 0) + count);
  const touched = EDIT_TOOLS.has(tool) ? entries.map(({ path: file }) => file) : [];
  const fresh = [...new Set([...due.keys(), ...touched])].filter((doc) => before.has(doc) && notes[doc] === undefined);
  for (const doc of fresh) notes[doc] = before.get(doc);

  const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b);
  if (!same(state.docReminders, reminders) || !same(state.problemNotes, notes))
    store.update({ docReminders: reminders, problemNotes: notes });
  if (due.size === 0 && fresh.length === 0) return '';

  logEvent(root, 'reminder', { docs: due.size, files: new Set([...due.values()].flat().map((e) => e.path)).size, problemNotes: fresh.length });
  return message(eventName, due, fresh.map((doc) => [doc, notes[doc]]));
}

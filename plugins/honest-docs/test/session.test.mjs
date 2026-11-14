// SessionStart (hooks/session-start.mjs), which takes the start set and names its size, and the doc
// reminder, which runs in hooks/post-tool.mjs on the paths a tool call was just attributed.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { agentSession, docsBaseline, git, readJson, runHook, sessionPath, tmpRepo, writeDocsRule, writeFiles } from './helpers.mjs';

const SESSION = 'session-1';

const doc = (globs) => `---\ncovers:\n${globs.map((g) => `  - '${g}'`).join('\n')}\n---\n\n# Doc\n`;

function project(t, files = {}) {
  const { root } = tmpRepo(t, {
    '_docs/features/alpha.md': doc(['src/**']),
    '_docs/features/beta.md': doc(['lib/*.ts']),
    'src/a.ts': '1\n',
    'src/b.ts': '1\n',
    'lib/x.ts': '1\n',
    'other.txt': '1\n',
    ...files,
  });
  const session = agentSession(root, SESSION);
  const editor = (file, text) => writeFileSync(path.join(root, file), text);
  const state = () => readJson(sessionPath(root, SESSION, 'state.json'));
  return { root, session, editor, state };
}

/** A repo whose docs pass docs-check but for `problems` broken links in _docs/doc.md. */
function withProblems(t, problems) {
  const links = Array.from({ length: problems }, (_, i) => `See [gone](gone-${i}.md).`).join('\n');
  const { root } = tmpRepo(t, { ...docsBaseline(), '_docs/doc.md': `# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\n${links}\n` });
  writeDocsRule(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'rule');
  return root;
}

test('session start: stores the problems there are as the start set, with the code version', (t) => {
  const root = withProblems(t, 2);
  const run = agentSession(root, SESSION).start();
  assert.equal(run.status, 0);
  const start = readJson(sessionPath(root, SESSION, 'start.json'));
  assert.equal(start.taken_by, 'session-start');
  assert.equal(typeof start.version, 'string');
  assert.deepEqual(start.problems, [
    { check: 'links', file: '_docs/doc.md', message: 'no such file: gone-0.md', count: 1 },
    { check: 'links', file: '_docs/doc.md', message: 'no such file: gone-1.md', count: 1 },
  ]);
});

test('session start: with 3 problems it prints one line naming them and the copy docs-check', (t) => {
  const root = withProblems(t, 3);
  const run = agentSession(root, SESSION).start();
  assert.equal(run.stdout, 'honest-docs: 3 docs problems in this repo (not blocking); list them with node .claude/honest-docs/scripts/docs-check.mjs\n');
});

test('session start: with none it prints nothing', (t) => {
  const root = withProblems(t, 0);
  const run = agentSession(root, SESSION).start();
  assert.deepEqual([run.status, run.stdout, run.stderr], [0, '', '']);
});

test('session start: a resume, /clear or compaction keeps the start set and prints the line again', (t) => {
  const root = withProblems(t, 1);
  const session = agentSession(root, SESSION);
  session.start();
  const first = readFileSync(sessionPath(root, SESSION, 'start.json'), 'utf8');
  // What the session broke since must not become a problem from before it.
  writeFiles(root, { '_docs/doc.md': '# Doc\n\nSee [lost](lost.md).\n' });
  for (const source of ['resume', 'clear', 'compact']) {
    const run = session.start(source);
    assert.match(run.stdout, /^honest-docs: \d docs problems? in this repo/, source);
    assert.equal(readFileSync(sessionPath(root, SESSION, 'start.json'), 'utf8'), first, source);
  }
});

test('reminder: names a doc when code it covers changes, once per doc per session', (t) => {
  const p = project(t);
  const first = p.session.write('src/a.ts', '2\n', 'Edit');
  assert.equal(first.status, 0);
  assert.equal(first.output.systemMessage, 'docs: check _docs/features/alpha.md');
  assert.equal(first.output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(first.output.hookSpecificOutput.additionalContext, /^Code a doc lists in its `covers:` frontmatter changed:\nsrc\/a\.ts → _docs\/features\/alpha\.md\n/);
  assert.equal(p.state().docReminders['_docs/features/alpha.md'], 'reminded');

  assert.equal(p.session.write('src/b.ts', '2\n').stdout, '');
  assert.equal(p.session.bash(() => p.editor('src/a.ts', '3\n')).stdout, '');
});

test('reminder: a doc git ignores is never named', (t) => {
  const p = project(t);
  p.editor('.gitignore', '_docs/priv/\n');
  mkdirSync(path.join(p.root, '_docs/priv'));
  p.editor('_docs/priv/notes.md', doc(['src/**']));
  assert.equal(p.session.write('src/a.ts', '2\n').output.systemMessage, 'docs: check _docs/features/alpha.md');
});

test('reminder: a covered file a Bash call deletes is named as deleted', (t) => {
  const p = project(t);
  const run = p.session.bash(() => rmSync(path.join(p.root, 'lib/x.ts')));
  assert.match(run.output.hookSpecificOutput.additionalContext, /lib\/x\.ts \(deleted\) → _docs\/features\/beta\.md/);
});

test('reminder: a doc the session changed stays quiet', (t) => {
  const p = project(t);
  assert.equal(p.session.write('_docs/features/beta.md', `${doc(['lib/*.ts'])}\nEdited.\n`).stdout, '');
  assert.equal(p.state().docReminders['_docs/features/beta.md'], 'edited');
  assert.equal(p.session.write('lib/x.ts', '2\n').stdout, '');
});

test('reminder: a doc changed in the same Bash call as its code stays quiet', (t) => {
  const p = project(t);
  const run = p.session.bash(() => {
    p.editor('_docs/features/alpha.md', `${doc(['src/**'])}\nEdited.\n`);
    p.editor('src/a.ts', '2\n');
  });
  assert.equal(run.stdout, '');
});

test('reminder: only attributed changes count: an editor edit gets none, at its time or later', (t) => {
  const p = project(t);
  p.editor('src/a.ts', 'editor\n');
  // A tool call that changes something else does not pick up the editor's edit.
  assert.equal(p.session.write('other.txt', '2\n').stdout, '');
  assert.equal(p.session.bash(() => p.editor('other.txt', '3\n')).stdout, '');
});

test('reminder: a new session names the doc again', (t) => {
  const p = project(t);
  p.session.write('src/a.ts', '2\n');
  const other = agentSession(p.root, 'session-2');
  assert.equal(other.write('src/b.ts', '2\n', 'Edit').output.systemMessage, 'docs: check _docs/features/alpha.md');
});

test('a doc with two problems from before the session: an Edit to it gets their count once, and the gate does not block', (t) => {
  const root = withProblems(t, 2);
  const session = agentSession(root, SESSION);
  session.start();
  const text = readFileSync(path.join(root, '_docs/doc.md'), 'utf8');

  const edit = session.write('_docs/doc.md', `${text}More.\n`, 'Edit');
  assert.equal(edit.output.systemMessage, undefined);
  assert.equal(edit.output.hookSpecificOutput.additionalContext, '_docs/doc.md has 2 docs problems from before this session');
  assert.equal(session.write('_docs/doc.md', `${text}More, again.\n`, 'Edit').stdout, '');

  const stop = runHook('stop-gate', { session_id: SESSION, cwd: root, permission_mode: 'default' }, { root });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stderr, '');
});

test('a reminded doc with problems from before the session gets their count beside the reminder', (t) => {
  const p = project(t, { '_docs/features/alpha.md': `${doc(['src/**'])}\nSee [gone](gone.md).\n` });
  p.session.start();
  const run = p.session.write('src/a.ts', '2\n');
  // The broken link and the missing Last Updated line.
  assert.match(run.output.hookSpecificOutput.additionalContext, /session\.\n\n_docs\/features\/alpha\.md has 2 docs problems from before this session$/);
});

// The session baseline (hooks/session-baseline.mjs) and the doc reminder (hooks/doc-reminder.mjs),
// which reads the snapshot the baseline stores.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { git, readJson, runHook, tmpRepo } from './helpers.mjs';

const SESSION = 'session-1';
const STATE = `artifacts/claude-hooks/honest-docs-${SESSION}.json`;

const doc = (globs) => `---\ncovers:\n${globs.map((g) => `  - '${g}'`).join('\n')}\n---\n\n# Doc\n`;

function project(t) {
  const { root } = tmpRepo(t, {
    '_docs/features/alpha.md': doc(['src/**']),
    '_docs/features/beta.md': doc(['lib/*.ts']),
    'src/a.ts': '1\n',
    'src/b.ts': '1\n',
    'lib/x.ts': '1\n',
    'other.txt': '1\n',
  });
  const write = (file, text) => writeFileSync(path.join(root, file), text);
  const baseline = (source = 'startup') => runHook('session-baseline', { session_id: SESSION, source }, { root });
  const toolUse = () => {
    const run = runHook('doc-reminder', { session_id: SESSION, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, { root });
    return { ...run, output: run.stdout ? JSON.parse(run.stdout) : null };
  };
  const state = () => readJson(path.join(root, STATE));
  const hash = (file) => git(root, 'hash-object', file).trim();
  return { root, write, baseline, toolUse, state, hash };
}

test('baseline: records the dirt already there as verified, and the tree snapshot', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'wip\n');
  p.write('new.txt', 'untracked\n');
  git(p.root, 'rm', '-q', 'other.txt');

  const run = p.baseline();
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  const state = p.state();
  assert.equal(state.version, 1);
  assert.deepEqual(state.verified, { 'new.txt': p.hash('new.txt'), 'src/a.ts': p.hash('src/a.ts') });
  assert.deepEqual(state.gaveUp, {});
  assert.deepEqual(state.treeSnapshot, { 'new.txt': p.hash('new.txt'), 'other.txt': null, 'src/a.ts': p.hash('src/a.ts') });
});

test('baseline: writes once and never overwrites an existing state', (t) => {
  const p = project(t);
  p.baseline();
  const first = readFileSync(path.join(p.root, STATE), 'utf8');

  p.write('src/a.ts', 'the agent broke this\n');
  for (const source of ['resume', 'clear', 'compact']) {
    assert.equal(p.baseline(source).status, 0);
    assert.equal(readFileSync(path.join(p.root, STATE), 'utf8'), first, source);
  }
});

test('baseline: another session gets its own state', (t) => {
  const p = project(t);
  p.baseline();
  runHook('session-baseline', { session_id: 'session-2', source: 'startup' }, { root: p.root });
  assert.ok(existsSync(path.join(p.root, 'artifacts/claude-hooks/honest-docs-session-2.json')));
});

test('reminder: names a doc when code it covers changes, once per doc per session', (t) => {
  const p = project(t);
  p.baseline();

  p.write('src/a.ts', '2\n');
  const first = p.toolUse();
  assert.equal(first.status, 0);
  assert.equal(first.output.systemMessage, 'docs: check _docs/features/alpha.md');
  assert.equal(first.output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(first.output.hookSpecificOutput.additionalContext, /^Code a doc lists in its `covers:` frontmatter changed:\nsrc\/a\.ts → _docs\/features\/alpha\.md\n/);
  assert.equal(p.state().docReminders['_docs/features/alpha.md'], 'reminded');

  p.write('src/b.ts', '2\n');
  assert.equal(p.toolUse().stdout, '');
  p.write('src/a.ts', '3\n');
  assert.equal(p.toolUse().stdout, '');
});

test('reminder: a deleted covered file is named as deleted', (t) => {
  const p = project(t);
  p.baseline();
  git(p.root, 'rm', '-q', 'lib/x.ts');
  assert.match(p.toolUse().output.hookSpecificOutput.additionalContext, /lib\/x\.ts \(deleted\) → _docs\/features\/beta\.md/);
});

test('reminder: a doc the session changed stays quiet', (t) => {
  const p = project(t);
  p.baseline();

  p.write('_docs/features/beta.md', `${doc(['lib/*.ts'])}\nEdited.\n`);
  assert.equal(p.toolUse().stdout, '');
  assert.equal(p.state().docReminders['_docs/features/beta.md'], 'edited');

  p.write('lib/x.ts', '2\n');
  assert.equal(p.toolUse().stdout, '');
});

test('reminder: a doc changed in the same step as its code stays quiet', (t) => {
  const p = project(t);
  p.baseline();
  p.write('_docs/features/alpha.md', `${doc(['src/**'])}\nEdited.\n`);
  p.write('src/a.ts', '2\n');
  assert.equal(p.toolUse().stdout, '');
});

test('reminder: work that predates the session is not a change', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'wip\n');
  p.baseline();
  assert.equal(p.toolUse().stdout, '');
  p.write('other.txt', '2\n');
  assert.equal(p.toolUse().stdout, '');
});

test('reminder: without a baseline it does nothing', (t) => {
  const p = project(t);
  p.write('src/a.ts', '2\n');
  const run = p.toolUse();
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.equal(existsSync(path.join(p.root, STATE)), false);
});

test('reminder: a new session names the doc again', (t) => {
  const p = project(t);
  p.baseline();
  p.write('src/a.ts', '2\n');
  p.toolUse();

  const other = (hook, payload) => runHook(hook, { session_id: 'session-2', ...payload }, { root: p.root });
  other('session-baseline', { source: 'startup' });
  p.write('src/b.ts', '2\n');
  assert.equal(JSON.parse(other('doc-reminder', { tool_name: 'Edit' }).stdout).systemMessage, 'docs: check _docs/features/alpha.md');
});

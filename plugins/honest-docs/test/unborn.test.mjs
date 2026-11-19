// A session on a repo with no commit yet, as right after `git init`: every file is untracked and
// there is no HEAD to compare with (core/attribution.mjs headBlobs, core/changed-files.mjs). The
// hooks must still attribute what the session changes, leave alone what it does not, take a first
// commit made in Bash for what it is, and let the gate run docs-check and the guard.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentSession, attributedLines, docsBaseline, git, readLines, runHook, writeDocsRule, writeFiles } from './helpers.mjs';

const SESSION = 'unborn';

/** Records every call to GUARD_RECORD and passes. */
const GUARD = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.GUARD_RECORD, JSON.stringify(process.argv.slice(2)) + '\\n');
`;

/** `git init` and files on disk, nothing committed; a guard outside the repo; a session started. */
function unbornProject(t) {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'honest-docs-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  const guard = path.join(dir, 'guard.mjs');
  const record = path.join(dir, 'guard-calls.jsonl');
  writeFileSync(guard, GUARD);
  writeFiles(root, {
    ...docsBaseline(),
    '.claude/honest-docs.json': JSON.stringify({ guard: { command: ['node', guard] } }),
    'src/c.ts': 'export const c = 1;\n',
    'src/d.ts': 'export const d = 1;\n',
  });
  writeDocsRule(root);
  assert.throws(() => git(root, 'rev-parse', '--verify', 'HEAD'));

  const session = agentSession(root, SESSION);
  session.start();
  const stop = () =>
    runHook(
      'stop-gate',
      { session_id: SESSION, cwd: root, hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false },
      { root, env: { GUARD_RECORD: record } }
    );
  const calls = () => (existsSync(record) ? readLines(record).map((line) => JSON.parse(line)) : []);
  return { root, session, stop, calls };
}

test('without a commit: what the session changes is attributed and checked, what it leaves alone is not', (t) => {
  const p = unbornProject(t);
  p.session.write('src/a.ts', 'export const a = 1;\n');
  p.session.bash(() => writeFiles(p.root, { 'src/b.ts': 'export const b = 1;\n', 'src/c.ts': 'export const c = 2;\n' }));
  assert.deepEqual(attributedLines(p.root, SESSION).map((e) => e.path), ['src/a.ts', 'src/b.ts', 'src/c.ts']);

  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(p.calls(), [['--changed', 'src/a.ts', 'src/b.ts', 'src/c.ts']]);
  assert.equal(p.stop().status, 0);
  assert.equal(p.calls().length, 1);
});

test('without a commit: a link the session breaks blocks as check docs', (t) => {
  const p = unbornProject(t);
  p.session.write('_docs/doc.md', '# Doc\n\n**Last Updated:** 2026-01-01\n\nSee [gone](gone.md).\n');
  const run = p.stop();
  assert.equal(run.status, 2);
  assert.match(run.stderr, /_docs\/doc\.md:5 {2}no such file: gone\.md/);
  assert.deepEqual(p.calls(), []);
});

test('the first commit, made in Bash, is not a change; an edit committed in the same call is', (t) => {
  const p = unbornProject(t);
  p.session.bash(() => {
    writeFiles(p.root, { 'src/c.ts': 'export const c = 3;\n' });
    git(p.root, 'add', '-A');
    git(p.root, 'commit', '-q', '-m', 'first');
  });
  assert.deepEqual(attributedLines(p.root, SESSION).map((e) => e.path), ['src/c.ts']);
  assert.equal(p.stop().status, 0);
  assert.deepEqual(p.calls(), [['--changed', 'src/c.ts']]);
});

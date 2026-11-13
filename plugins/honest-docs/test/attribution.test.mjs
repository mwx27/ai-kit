// Attribution (core/attribution.mjs through hooks/pre-tool.mjs and hooks/post-tool.mjs): which paths a
// tool call changed, recorded in the session's attributed.jsonl.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { readAttributed } from '../core/attribution.mjs';
import { PLUGIN_ROOT, agentSession, attributedLines, eventLog, git, sessionPath, tmpRepo, writeFiles } from './helpers.mjs';

const SESSION = 's1';

function project(t, files = {}) {
  const { dir, root } = tmpRepo(t, { 'src/a.ts': '1\n', 'src/gone.ts': '1\n', '_docs/doc.md': '# Doc\n', ...files });
  const session = agentSession(root, SESSION);
  const editor = (file, text) => writeFiles(root, { [file]: text });
  const recorded = () => attributedLines(root, SESSION).map(({ by, path: file, deleted }) => [by, file, deleted ?? false]);
  return { dir, root, session, editor, recorded };
}

test('Edit, Write and NotebookEdit record the repo-relative POSIX path', (t) => {
  const p = project(t);
  p.session.write('src/a.ts', '2\n', 'Edit');
  p.session.write('src/new.ts', '1\n', 'Write');
  p.session.write('nb/x.ipynb', '{}\n', 'NotebookEdit');
  // A relative path is taken from the hook's cwd.
  p.session.tool('Edit', { file_path: 'src/a.ts' });
  assert.deepEqual(p.recorded(), [
    ['Edit', 'src/a.ts', false],
    ['Write', 'src/new.ts', false],
    ['NotebookEdit', 'nb/x.ipynb', false],
    ['Edit', 'src/a.ts', false],
  ]);
});

test('a path outside the root, in the plugin\'s folders or ignored by git is not recorded', (t) => {
  const p = project(t, { '.gitignore': 'build/\n' });
  writeFiles(p.dir, { 'elsewhere.ts': '1\n' });
  p.editor('build/out.js', '1\n');
  p.editor('artifacts/logs/x.md', '1\n');
  for (const file of [path.join(p.dir, 'elsewhere.ts'), '../elsewhere.ts', path.join(p.root, 'build/out.js'), path.join(p.root, 'artifacts/logs/x.md')])
    assert.equal(p.session.tool('Write', { file_path: file }).status, 0);
  p.session.tool('Write', {});
  assert.deepEqual(p.recorded(), []);
});

test('Bash: a file created, one modified and one deleted are recorded, the deletion as deleted', (t) => {
  const p = project(t);
  p.session.bash(() => {
    p.editor('src/new.ts', '1\n');
    p.editor('src/a.ts', '2\n');
    rmSync(path.join(p.root, 'src/gone.ts'));
  });
  assert.deepEqual(p.recorded(), [
    ['Bash', 'src/a.ts', false],
    ['Bash', 'src/gone.ts', true],
    ['Bash', 'src/new.ts', false],
  ]);
  assert.deepEqual([...readAttributed(sessionPath(p.root, SESSION))], [
    ['src/a.ts', { deleted: false }],
    ['src/gone.ts', { deleted: true }],
    ['src/new.ts', { deleted: false }],
  ]);
});

test('Bash: a file already dirty before the call is recorded only when the call changes it again', (t) => {
  const p = project(t);
  p.editor('src/a.ts', 'editor\n');
  p.session.bash(() => p.editor('src/new.ts', '1\n'));
  p.session.bash(() => p.editor('src/a.ts', 'agent\n'));
  assert.deepEqual(p.recorded(), [
    ['Bash', 'src/new.ts', false],
    ['Bash', 'src/a.ts', false],
  ]);
});

test('Bash: a call that fails (PostToolUseFailure) records its changes like a Post', (t) => {
  const p = project(t);
  p.session.bash(() => p.editor('src/a.ts', '2\n'), { event: 'PostToolUseFailure' });
  assert.deepEqual(p.recorded(), [['Bash', 'src/a.ts', false]]);
});

test('Bash: two calls in flight each compare with their own Pre, which their Post removes', (t) => {
  const p = project(t);
  p.session.pre('A');
  p.session.pre('B');
  p.editor('src/one.ts', '1\n');
  p.session.post('A');
  p.editor('src/two.ts', '1\n');
  p.session.post('B');
  const byCall = (id) => attributedLines(p.root, SESSION).filter((e) => e.id === id).map((e) => e.path);
  assert.deepEqual(byCall('A'), ['src/one.ts']);
  // B's window held both writes: everything changed in a Bash call's window is the call's.
  assert.deepEqual(byCall('B'), ['src/one.ts', 'src/two.ts']);
  assert.deepEqual(readdirSync(sessionPath(p.root, SESSION, 'pre')), []);
});

test('Bash: a Post with no Pre records nothing and logs no-pre', (t) => {
  const p = project(t);
  const run = p.session.bash(() => p.editor('src/a.ts', '2\n'), { pre: false });
  assert.deepEqual([run.status, run.stdout], [0, '']);
  assert.deepEqual(p.recorded(), []);
  assert.deepEqual(
    eventLog(p.root).filter((e) => e.event === 'attribution').map((e) => [e.tool, e.reason]),
    [['Bash', 'no-pre']]
  );
});

test('Bash: git commit is not a change, an edit committed in the same call is', (t) => {
  const p = project(t);
  p.editor('src/a.ts', 'wip\n');
  p.editor('src/new.ts', 'wip\n');
  p.session.bash(() => {
    git(p.root, 'add', 'src/a.ts', 'src/new.ts');
    git(p.root, 'commit', '-q', '-m', 'wip');
  });
  assert.deepEqual(p.recorded(), []);

  p.editor('src/a.ts', 'more\n');
  p.session.bash(() => {
    p.editor('src/a.ts', 'edited by the call\n');
    git(p.root, 'commit', '-q', '-am', 'edit');
  });
  assert.deepEqual(p.recorded(), [['Bash', 'src/a.ts', false]]);
});

test('Bash: git pull and git checkout of another branch attribute nothing', (t) => {
  const p = project(t);
  const upstream = path.join(p.dir, 'upstream');
  git(p.dir, 'clone', '-q', p.root, upstream);
  writeFiles(upstream, { '_docs/doc.md': '# Doc\n\nFrom upstream.\n' });
  git(upstream, 'commit', '-q', '-am', 'upstream');
  git(p.root, 'checkout', '-q', '-b', 'other');
  writeFiles(p.root, { '_docs/doc.md': '# Doc\n\nOn other.\n', 'src/other.ts': '1\n' });
  git(p.root, 'add', '-A');
  git(p.root, 'commit', '-q', '-m', 'other');
  git(p.root, 'checkout', '-q', 'main');

  const docText = () => readFileSync(path.join(p.root, '_docs/doc.md'), 'utf8');
  p.session.bash(() => git(p.root, 'pull', '-q', '--ff-only', upstream, 'main'));
  assert.match(docText(), /From upstream/);
  p.session.bash(() => git(p.root, 'checkout', '-q', 'other'));
  assert.match(docText(), /On other/);
  assert.deepEqual(p.recorded(), []);
});

test('Bash: git stash pop of a change to a doc is attributed (a documented limit)', (t) => {
  const p = project(t);
  p.editor('_docs/doc.md', '# Doc\n\nStashed.\n');
  git(p.root, 'stash', '-q');
  assert.doesNotMatch(readFileSync(path.join(p.root, '_docs/doc.md'), 'utf8'), /Stashed/);
  p.session.bash(() => git(p.root, 'stash', 'pop', '-q'));
  assert.deepEqual(p.recorded(), [['Bash', '_docs/doc.md', false]]);
});

test('parallel appends: 8 processes of 200 lines each, all 1,600 readable', async (t) => {
  const { root } = tmpRepo(t);
  const dir = sessionPath(root, SESSION);
  const module = pathToFileURL(path.join(PLUGIN_ROOT, 'core', 'attribution.mjs')).href;
  const script = `const { recordPaths } = await import(${JSON.stringify(module)});
for (let i = 0; i < 200; i++) recordPaths(process.argv[1], { by: 'Bash', id: process.argv[2], entries: [{ path: 'src/' + process.argv[2] + '-' + i + '.ts', deleted: false }] });`;
  await Promise.all(
    Array.from({ length: 8 }, (_, n) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir, `p${n}`], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    }))
  );
  const lines = attributedLines(root, SESSION);
  assert.equal(lines.length, 1600);
  assert.equal(readAttributed(dir).size, 1600);
});

test('a torn last line is skipped and the others are read', (t) => {
  const { root } = tmpRepo(t);
  const dir = sessionPath(root, SESSION);
  writeFiles(root, { [path.relative(root, path.join(dir, 'attributed.jsonl'))]: '{"path":"src/a.ts"}\n{"path":"src/b.ts","del' });
  assert.deepEqual([...readAttributed(dir).keys()], ['src/a.ts']);
  appendFileSync(path.join(dir, 'attributed.jsonl'), '\nnot json\n{"path":"src/c.ts","deleted":true}\n');
  assert.deepEqual([...readAttributed(dir)], [['src/a.ts', { deleted: false }], ['src/c.ts', { deleted: true }]]);
  assert.ok(existsSync(dir));
});

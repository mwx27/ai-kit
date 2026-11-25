// scripts/install.mjs --check-empty (core/empty-project.mjs): whether the project has no code yet,
// judged by its files and not by its commits, and which of them an app generator would refuse.
// /honest-docs:init runs it first and asks about generating the app before installing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN_ROOT, cleanEnv, git, writeFiles } from './helpers.mjs';

/** A fresh `git init` folder holding `files`, committed when `commit` is set; nothing else in it. */
function project(t, files = {}, { commit = false } = {}) {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'honest-docs-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFiles(root, files);
  if (commit) {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fixture');
  }
  return root;
}

function checkEmpty(cwd, args = ['--check-empty']) {
  const run = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'install.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** The one JSON line --check-empty prints, after checking it exited 0 and printed nothing else. */
function result(root) {
  const run = checkEmpty(root);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  const lines = run.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, run.stdout);
  return JSON.parse(lines[0]);
}

test('a repo with nothing but .git is empty, and nothing blocks a generator', (t) => {
  assert.deepEqual(result(project(t)), { empty: true, blocking: [] });
});

test('a README and a LICENSE, not committed, are no code; the README would block a generator', (t) => {
  assert.deepEqual(result(project(t, { README: '# x\n', LICENSE: 'MIT\n' })), { empty: true, blocking: ['README'] });
});

test('a repo whose only commit holds a README, a LICENSE and a .gitignore is empty: commits do not count', (t) => {
  const root = project(t, { 'README.md': '# x\n', LICENSE: 'MIT\n', '.gitignore': 'node_modules/\n' }, { commit: true });
  assert.deepEqual(result(root), { empty: true, blocking: ['README.md'] });
});

test('README.md and LICENSE.md are no code, and both would block a generator', (t) => {
  const root = project(t, { 'README.md': '# x\n', 'LICENSE.md': 'MIT\n' });
  assert.deepEqual(result(root), { empty: true, blocking: ['LICENSE.md', 'README.md'] });
});

test('.claude/ with settings is no code, but create-expo would refuse it', (t) => {
  const root = project(t, { '.claude/settings.json': '{}\n' });
  assert.deepEqual(result(root), { empty: true, blocking: ['.claude'] });
});

test('CLAUDE.md is no code, but both generators would refuse it', (t) => {
  assert.deepEqual(result(project(t, { 'CLAUDE.md': '# x\n' })), { empty: true, blocking: ['CLAUDE.md'] });
});

test('LICENCE, the British spelling, is no code', (t) => {
  assert.deepEqual(result(project(t, { LICENCE: 'MIT\n' })), { empty: true, blocking: ['LICENCE'] });
});

test('a file that only starts like a licence or a readme is code', (t) => {
  assert.equal(result(project(t, { 'licenseServer.js': 'export {};\n' })).empty, false);
  assert.equal(result(project(t, { 'readme-generator.ts': 'export {};\n' })).empty, false);
});

test('outside a git repository --check-empty judges the current folder and prints the same JSON', (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'honest-docs-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, { 'README.md': '# x\n' });
  assert.deepEqual(result(dir), { empty: true, blocking: ['README.md'] });
  writeFiles(dir, { 'index.js': '\n' });
  assert.deepEqual(result(dir), { empty: false, blocking: ['README.md', 'index.js'] });
});

test('files both generators tolerate are neither code nor blocking', (t) => {
  const root = project(t, { '.gitignore': '', LICENSE: '', 'docs/a.md': '', '.idea/x': '', 'app.iml': '' });
  assert.deepEqual(result(root), { empty: true, blocking: [] });
});

test('a generated app, not yet committed, is not empty', (t) => {
  const root = project(t, {
    'package.json': '{}\n',
    'app/page.tsx': 'export default function Page() { return null; }\n',
    '.gitignore': 'node_modules/\n',
    'README.md': '# x\n',
  });
  assert.equal(result(root).empty, false);
});

test('a repo with code and a commit is not empty', (t) => {
  const root = project(t, { 'src/index.ts': 'export {};\n', 'README.md': '# x\n' }, { commit: true });
  assert.equal(result(root).empty, false);
});

test('--check-empty writes nothing: the folder and git status stay as they were', (t) => {
  const root = project(t, { 'README.md': '# x\n' });
  const before = { files: readdirSync(root).sort(), status: git(root, 'status', '--porcelain', '--ignored') };
  result(root);
  assert.deepEqual({ files: readdirSync(root).sort(), status: git(root, 'status', '--porcelain', '--ignored') }, before);
});

test('--check-empty run from a subfolder judges the whole repo', (t) => {
  const root = project(t, { 'src/index.ts': 'export {};\n' });
  const run = checkEmpty(path.join(root, 'src'));
  assert.equal(JSON.parse(run.stdout).empty, false);
});

test('--check-empty with any other argument is a bad command line', (t) => {
  const root = project(t);
  for (const args of [['--check-empty', '--mode', 'init'], ['--mode', 'init', '--check-empty']]) {
    const run = checkEmpty(root, args);
    assert.equal(run.status, 2);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /^usage: install\.mjs .*--check-empty\n$/);
  }
});

// The code run from a copy in the project (.claude/honest-docs/, core/version.mjs) rather than from
// the plugin: its version comes from manifest.json, docs-check works from it, and its hooks act only
// on a repository that holds the copy (core/root.mjs).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hookRoot } from '../core/root.mjs';
import { installedVersion } from '../core/version.mjs';
import { PLUGIN_ROOT, PLUGIN_VERSION, cleanEnv, eventLog, git, runBin, runHook, tmpRepo, writeFiles } from './helpers.mjs';

const COPY = '.claude/honest-docs';
const HOOKS = ['session-baseline', 'doc-reminder', 'instructions-log', 'stop-gate'];

/** What /honest-docs:init will copy (impl plan 1.8), and a manifest naming `version`, or none. */
function installCopy(root, { version = '0.2.0' } = {}) {
  const copy = path.join(root, COPY);
  cpSync(path.join(PLUGIN_ROOT, 'core'), path.join(copy, 'core'), { recursive: true });
  cpSync(path.join(PLUGIN_ROOT, 'templates'), path.join(copy, 'templates'), { recursive: true });
  mkdirSync(path.join(copy, 'hooks'));
  for (const file of readdirSync(path.join(PLUGIN_ROOT, 'hooks')).filter((f) => f.endsWith('.mjs')))
    cpSync(path.join(PLUGIN_ROOT, 'hooks', file), path.join(copy, 'hooks', file));
  mkdirSync(path.join(copy, 'scripts'));
  for (const file of ['docs-check.mjs', 'docs-grep.mjs'])
    cpSync(path.join(PLUGIN_ROOT, 'scripts', file), path.join(copy, 'scripts', file));
  if (version) writeFileSync(path.join(copy, 'manifest.json'), `${JSON.stringify({ version, files: {}, hooks: {} })}\n`);
  return copy;
}

/** A repo /honest-docs:init set up, with the copy beside it, committed. */
function initialised(t, options) {
  const project = tmpRepo(t, { 'CLAUDE.md': '# Project\n' });
  const init = runBin('honest-docs-init', [], { cwd: project.root });
  assert.equal(init.status, 0, init.stderr);
  const copy = installCopy(project.root, options);
  git(project.root, 'add', '-A');
  git(project.root, 'commit', '-q', '-m', 'init');
  return { ...project, copy };
}

/** One of the copy's hooks, as the settings.json entry runs it. */
function runCopyHook(copy, hook, payload, { projectDir }) {
  const run = spawnSync(process.execPath, [path.join(copy, 'hooks', `${hook}.mjs`)], {
    cwd: projectDir,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_PROJECT_DIR: projectDir }),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** A payload for `hook` that would make it write something, with `cwd`. */
const payload = (hook, cwd) =>
  ({
    'session-baseline': { session_id: 's', cwd, source: 'startup' },
    'doc-reminder': { session_id: 's', cwd, tool_name: 'Edit' },
    'instructions-log': { session_id: 's', cwd, hook_event_name: 'InstructionsLoaded', file_path: path.join(cwd, 'CLAUDE.md'), load_reason: 'session_start' },
    'stop-gate': { session_id: 's', cwd, permission_mode: 'default' },
  })[hook];

/** Every path in `root` git does not track, ignored ones included: what a hook wrote. */
const untracked = (root) => git(root, 'status', '--porcelain', '--ignored', '--untracked-files=all');

test('installedVersion: the manifest wins over plugin.json, plugin.json is the fallback', (t) => {
  const { dir } = tmpRepo(t);
  writeFiles(dir, { 'both/manifest.json': '{ "version": "0.2.0" }', 'both/.claude-plugin/plugin.json': '{ "version": "0.1.8" }' });
  assert.equal(installedVersion(path.join(dir, 'both')), '0.2.0');
  assert.equal(installedVersion(PLUGIN_ROOT), PLUGIN_VERSION);
});

test('installedVersion: a root with neither file is an error naming both', (t) => {
  const { dir } = tmpRepo(t);
  assert.throws(() => installedVersion(dir), (error) => {
    assert.match(error.message, /neither manifest\.json nor \.claude-plugin\/plugin\.json/);
    return true;
  });
});

test('docs-check from a copy without a manifest stops on that error, not a TypeError', (t) => {
  const { root } = initialised(t, { version: null });
  const run = spawnSync(process.execPath, [path.join(root, COPY, 'scripts', 'docs-check.mjs')], { cwd: root, encoding: 'utf8', env: cleanEnv() });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /neither manifest\.json nor \.claude-plugin\/plugin\.json/);
  assert.doesNotMatch(run.stderr, /TypeError/);
});

test('docs-check run from the copy passes init, and logs the manifest version from a hook', (t) => {
  const { root, copy } = initialised(t);
  const script = path.join(copy, 'scripts', 'docs-check.mjs');

  const json = spawnSync(process.execPath, [script, '--json'], { cwd: root, encoding: 'utf8', env: cleanEnv() });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).problems, []);
  // From a terminal: no event log.
  assert.deepEqual(eventLog(root), []);

  const hooked = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: cleanEnv({ HONEST_DOCS_HOOK: '1' }) });
  assert.equal(hooked.status, 0, hooked.stderr);
  const [event] = eventLog(root);
  assert.equal(event.event, 'docs-check');
  assert.equal(event.pluginVersion, '0.2.0');
  assert.equal(event.pluginRoot, copy);
});

test('the copy gate runs the copy docs-check and hands the guard the copy scripts/', (t) => {
  const { root, copy, dir } = initialised(t);
  const record = path.join(dir, 'guard-env');
  const guard = path.join(dir, 'guard.cjs');
  writeFiles(dir, {
    'guard.cjs': `require('node:fs').writeFileSync(${JSON.stringify(record)}, process.env.HONEST_DOCS_SCRIPTS + ' ' + process.env.HONEST_DOCS_HOOK);\n`,
  });
  writeFiles(root, { '.claude/honest-docs.json': JSON.stringify({ guard: { command: ['node', guard] } }), 'src/a.ts': '1\n' });
  // The copy is the plugin's own folder: a file there is never a change to check.
  writeFiles(copy, { 'scratch.txt': 'x\n' });

  const run = runCopyHook(copy, 'stop-gate', payload('stop-gate', root), { projectDir: root });
  assert.equal(run.status, 0, run.stderr);
  // The config and src/a.ts.
  assert.match(JSON.parse(run.stdout).systemMessage, /^docs-check, guard --changed: 2 files, /);
  assert.equal(readFileSync(record, 'utf8'), `${path.join(copy, 'scripts')} 1`);
  assert.deepEqual(eventLog(root).map((e) => [e.event, e.pluginVersion]), [['docs-check', '0.2.0'], ['gate', '0.2.0']]);
});

test('hookRoot from a copy: a folder in a worktree resolves to the worktree root', (t) => {
  const { root, copy, dir } = initialised(t);
  const worktree = path.join(dir, 'wt');
  git(root, 'worktree', 'add', '-q', worktree);
  mkdirSync(path.join(worktree, 'src'));
  assert.equal(hookRoot({ cwd: path.join(worktree, 'src') }, copy), worktree);
  assert.equal(hookRoot({ cwd: root }, copy), root);
});

test('a copy hook started for the main checkout acts on the worktree its cwd is in', (t) => {
  const { root, copy, dir } = initialised(t);
  const worktree = path.join(dir, 'wt');
  git(root, 'worktree', 'add', '-q', worktree);
  writeFiles(worktree, { 'src/a.ts': '1\n' });

  // CLAUDE_PROJECT_DIR stays at the main checkout, as Claude Code keeps it.
  const run = runCopyHook(copy, 'stop-gate', payload('stop-gate', worktree), { projectDir: root });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(path.join(worktree, 'artifacts/logs/guard-gate-s.log')));
  assert.equal(existsSync(path.join(root, 'artifacts')), false);
});

test('a copy hook whose cwd is in a sibling repo without the copy exits 0 and writes nothing', (t) => {
  const { root, copy } = initialised(t);
  const sibling = tmpRepo(t, {
    '.claude/honest-docs.json': JSON.stringify({ instructionsLog: true }),
    'CLAUDE.md': '# Sibling\n\nSee [gone](gone.md).\n',
  });
  writeFiles(sibling.root, { 'src/a.ts': '1\n' });
  const before = [untracked(root), untracked(sibling.root)];

  for (const hook of HOOKS) {
    const run = runCopyHook(copy, hook, payload(hook, sibling.root), { projectDir: root });
    assert.deepEqual([hook, run.status, run.stdout, run.stderr], [hook, 0, '', '']);
  }
  assert.deepEqual([untracked(root), untracked(sibling.root)], before);
});

test('the plugin hook in the same situation acts on CLAUDE_PROJECT_DIR, as 0.1.8 did', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': '# Project\n' });
  const sibling = tmpRepo(t, { 'CLAUDE.md': '# Sibling\n' });
  writeFiles(sibling.root, { 'src/a.ts': '1\n' });
  const before = untracked(sibling.root);

  const run = runHook('stop-gate', payload('stop-gate', sibling.root), { root });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(path.join(root, 'artifacts/logs/guard-gate-s.log')));
  assert.equal(untracked(sibling.root), before);
});

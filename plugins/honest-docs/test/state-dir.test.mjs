// Where the hooks write: .claude/honest-docs-state/ (core/state-dir.mjs), which ignores itself in git,
// the session folders SessionStart removes after 30 days (core/session-state.mjs), and the plugin's
// folders a walk of the tree skips by their full path (core/config.mjs skippedPath).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, skippedPath } from '../core/config.mjs';
import { SESSION_MAX_AGE_MS, removeOldSessions } from '../core/session-state.mjs';
import { makeDir } from '../core/state-dir.mjs';
import { LOG_DIR, PLUGIN_ROOT, STATE_DIR, agentSession, eventLog, git, runHook, runScript, sessionPath, tmpRepo, writeFiles } from './helpers.mjs';

const SESSION = 'session-1';
const DAY = 24 * 60 * 60 * 1000;

/** Sets the mtime of `file` and, for a folder, of everything in it, `days` back. */
function age(file, days) {
  const when = new Date(Date.now() - days * DAY);
  if (statSync(file).isDirectory()) for (const name of readdirSync(file)) age(path.join(file, name), days);
  utimesSync(file, when, when);
}

test('a whole session writes only in the state folder, which stays out of git status', (t) => {
  const { root } = tmpRepo(t, { '.claude/honest-docs.json': JSON.stringify({ instructionsLog: true }), 'src/a.ts': '1\n' });
  const session = agentSession(root, SESSION);
  session.start();
  session.write('src/a.ts', '2\n');
  session.bash(() => writeFiles(root, { 'src/b.ts': '1\n' }));
  runHook('instructions-log', { session_id: SESSION, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.ts') } }, { root });
  runHook('stop-gate', { session_id: SESSION, cwd: root, hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false }, { root });

  assert.equal(readFileSync(path.join(root, STATE_DIR, '.gitignore'), 'utf8'), '*\n');
  for (const file of ['state.json', 'start.json', 'attributed.jsonl']) assert.ok(existsSync(sessionPath(root, SESSION, file)), file);
  const logs = readdirSync(path.join(root, LOG_DIR));
  for (const prefix of ['events.jsonl', 'guard-gate-', 'instructions-']) assert.ok(logs.some((name) => name.startsWith(prefix)), prefix);
  const status = git(root, 'status', '--porcelain', '--untracked-files=all');
  assert.doesNotMatch(status, /honest-docs-state/);
});

test('only core/state-dir.mjs makes a folder for the hooks; install alone makes its own', () => {
  const sources = ['core', 'hooks'].flatMap((dir) =>
    readdirSync(path.join(PLUGIN_ROOT, dir))
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => `${dir}/${name}`)
  );
  const making = sources.filter((file) => /\bmkdirSync\b/.test(readFileSync(path.join(PLUGIN_ROOT, file), 'utf8')));
  assert.deepEqual(making.sort(), ['core/install.mjs', 'core/state-dir.mjs']);
});

test('makeDir: the .gitignore goes in the state folder only, and one already there is kept', (t) => {
  const { root } = tmpRepo(t);
  makeDir(path.join(root, STATE_DIR, 'sessions', 'x'));
  assert.equal(readFileSync(path.join(root, STATE_DIR, '.gitignore'), 'utf8'), '*\n');
  assert.equal(existsSync(path.join(root, STATE_DIR, 'sessions', '.gitignore')), false);

  writeFiles(root, { [`${STATE_DIR}/.gitignore`]: '# mine\n*\n' });
  makeDir(path.join(root, LOG_DIR));
  assert.equal(readFileSync(path.join(root, STATE_DIR, '.gitignore'), 'utf8'), '# mine\n*\n');

  makeDir(path.join(root, 'tmp', 'state'));
  assert.equal(existsSync(path.join(root, 'tmp', 'state', '.gitignore')), false);
  assert.equal(existsSync(path.join(root, 'tmp', '.gitignore')), false);
});

test('removeOldSessions: a session untouched for 30 days goes, a recent one and the current one stay', (t) => {
  const { root } = tmpRepo(t);
  const parent = path.join(root, STATE_DIR, 'sessions');
  writeFiles(parent, {
    'old/state.json': '{}\n',
    'old/pre/x.json': '{}\n',
    'touched/state.json': '{}\n',
    'touched/attributed.jsonl': '{}\n',
    'current/state.json': '{}\n',
    'loose.json': '{}\n',
  });
  age(path.join(parent, 'old'), 31);
  age(path.join(parent, 'touched'), 31);
  utimesSync(path.join(parent, 'touched', 'attributed.jsonl'), new Date(), new Date());
  age(path.join(parent, 'current'), 40);
  age(path.join(parent, 'loose.json'), 40);

  assert.equal(removeOldSessions(parent, 'current'), 1);
  assert.deepEqual(readdirSync(parent).sort(), ['current', 'loose.json', 'touched']);
  assert.equal(removeOldSessions(path.join(root, 'missing'), 'current'), 0);
  assert.equal(SESSION_MAX_AGE_MS, 30 * DAY);
});

test('SessionStart removes the old sessions and logs how many', (t) => {
  const { root } = tmpRepo(t);
  writeFiles(root, { [`${STATE_DIR}/sessions/old/state.json`]: '{}\n', [`${STATE_DIR}/sessions/new/state.json`]: '{}\n' });
  age(path.join(root, STATE_DIR, 'sessions', 'old'), 31);
  agentSession(root, SESSION).start();
  assert.deepEqual(readdirSync(path.join(root, STATE_DIR, 'sessions')).sort(), ['new', SESSION]);
  assert.equal(eventLog(root).find((e) => e.event === 'session-start').removed, 1);
});

test('skippedPath: dependencies and git at any depth, the state and logs by their full path', (t) => {
  const { root } = tmpRepo(t);
  const skipped = skippedPath(loadConfig(root));
  for (const rel of ['.git', 'a/node_modules', 'a/node_modules/b.md', STATE_DIR, `${LOG_DIR}/x.log`]) assert.ok(skipped(rel), rel);
  for (const rel of ['.claude', '.claude/rules/r.md', `_docs/${STATE_DIR}`, '.claude/honest-docs-statex']) assert.ok(!skipped(rel), rel);

  writeFiles(root, { '.claude/honest-docs.json': JSON.stringify({ stateDir: 'tmp/state/', logDir: 'tmp/logs' }) });
  const moved = skippedPath(loadConfig(root));
  assert.ok(moved('tmp/state/sessions/x'));
  assert.ok(moved('tmp/logs'));
  assert.ok(!moved('tmp/other.md'));
  assert.ok(!moved(STATE_DIR));
});

test('without git a walk of .claude/ reads the rules and skips the state folder', (t) => {
  const { root } = tmpRepo(t, {
    '.claude/honest-docs.json': JSON.stringify({ scan: { dirs: ['.claude', '_docs'] } }),
    '.claude/rules/r.md': '# R\n\n[gone](gone.md)\n',
    [`${LOG_DIR}/n.md`]: '# N\n\n[gone](gone.md)\n',
    '_docs/.claude/honest-docs-state/x.md': '# X\n\n**Last Updated:** 2026-01-01\n\n[gone](gone.md)\n',
  });
  rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const run = runScript('docs-check', [], { cwd: root });
  assert.ok(run.stderr.includes('.claude/rules/r.md:3  no such file: gone.md'), run.stderr);
  assert.ok(run.stderr.includes('_docs/.claude/honest-docs-state/x.md:5  no such file: gone.md'), run.stderr);
  assert.doesNotMatch(run.stderr, /logs\/n\.md/);
});

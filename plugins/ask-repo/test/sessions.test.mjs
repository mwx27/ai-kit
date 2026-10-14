// Where sessions are kept, how -c picks one, -a, and pruning (core/sessions.mjs).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { argAfter, askRepo, git, setupWithAlias } from './helpers.mjs';

const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000);
const age = (dir, name, date) => {
  for (const ext of ['id', 'md']) utimesSync(path.join(dir, `${name}.${ext}`), date, date);
};

test('a new session is kept in the project root, git-ignored by itself', (t) => {
  const { project, sessions, env, calls } = setupWithAlias(t);
  mkdirSync(path.join(project, 'src'));
  const run = askRepo(['-n', 'auth', 'web', 'How is auth done?'], { cwd: path.join(project, 'src'), env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /ask-repo -c web auth "question"/);

  const [call] = calls();
  assert.equal(readFileSync(path.join(sessions, 'auth.id'), 'utf8').trim(), argAfter(call.argv, '--session-id'));
  const log = readFileSync(path.join(sessions, 'auth.md'), 'utf8');
  assert.match(log, /^# Session: web \/ auth\n/);
  assert.match(log, /\*\*Q\*\* \*\(.+\)\*: How is auth done\?/);
  assert.match(log, /answer to: How is auth done\?/);
  assert.equal(git(project, 'status', '--porcelain'), '');
});

test('without -n a session is named by the time', (t) => {
  const { project, sessions, env } = setupWithAlias(t);
  assert.equal(askRepo(['web', 'q1'], { cwd: project, env }).status, 0);
  assert.equal(askRepo(['web', 'q2'], { cwd: project, env }).status, 0);
  const ids = readdirSync(sessions).filter((file) => file.endsWith('.id'));
  assert.equal(ids.length, 2);
  for (const id of ids) assert.match(id, /^\d{8}-\d{6}(-\d+)?\.id$/);
});

test('outside git the session is kept under the current folder', (t) => {
  const { env } = setupWithAlias(t);
  const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ask-repo-outside-')));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const run = askRepo(['-n', 'x', 'web', 'q'], { cwd: outside, env: { ...env, GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(path.join(outside, 'artifacts', 'ask-repo', 'web', 'x.id')));
});

test('-c with a name resumes that session and appends to its log', (t) => {
  const { project, sessions, env, calls } = setupWithAlias(t);
  askRepo(['-n', 'auth', 'web', 'first'], { cwd: project, env });
  const run = askRepo(['-c', 'web', 'auth', 'second'], { cwd: project, env });
  assert.equal(run.status, 0, run.stderr);

  const [first, second] = calls();
  assert.equal(argAfter(second.argv, '--resume'), argAfter(first.argv, '--session-id'));
  assert.equal(argAfter(second.argv, '--append-system-prompt-file'), argAfter(first.argv, '--append-system-prompt-file'));
  assert.match(readFileSync(path.join(sessions, 'auth.md'), 'utf8'), /answer to: first\n\n---\n\n\*\*Q\*\*.*: second/s);
});

test('-c without a name resumes the session used last, not the one started last', (t) => {
  const { project, sessions, env, calls } = setupWithAlias(t);
  askRepo(['-n', 'older', 'web', 'q'], { cwd: project, env });
  askRepo(['-n', 'newer', 'web', 'q'], { cwd: project, env });
  age(sessions, 'older', hoursAgo(3));
  age(sessions, 'newer', hoursAgo(2));
  askRepo(['-c', 'web', 'older', 'follow-up'], { cwd: project, env });

  const run = askRepo(['-c', 'web', 'another'], { cwd: project, env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /continued session older/);
  const olderId = readFileSync(path.join(sessions, 'older.id'), 'utf8').trim();
  assert.equal(argAfter(calls().at(-1).argv, '--resume'), olderId);
});

test('-c with no session or an unknown name fails', (t) => {
  const { project, env } = setupWithAlias(t);
  assert.match(askRepo(['-c', 'web', 'q'], { cwd: project, env }).stderr, /no session to continue/);
  assert.match(askRepo(['-c', 'web', 'nope', 'q'], { cwd: project, env }).stderr, /no session nope/);
});

test('-n with a name already taken points to -c', (t) => {
  const { project, env } = setupWithAlias(t);
  askRepo(['-n', 'auth', 'web', 'q'], { cwd: project, env });
  const run = askRepo(['-n', 'auth', 'web', 'q'], { cwd: project, env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /ask-repo -c web auth/);
});

test('-a keeps nothing and asks claude not to save the session', (t) => {
  const { project, env, calls } = setupWithAlias(t);
  const run = askRepo(['-a', 'web', 'q'], { cwd: project, env });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!existsSync(path.join(project, 'artifacts')));
  assert.ok(calls()[0].argv.includes('--no-session-persistence'));
  assert.equal(argAfter(calls()[0].argv, '--session-id'), undefined);
});

test('a session unused for 7 days is deleted with both files; one continued recently stays', (t) => {
  const { project, sessions, env } = setupWithAlias(t);
  askRepo(['-n', 'stale', 'web', 'q'], { cwd: project, env });
  askRepo(['-n', 'active', 'web', 'q'], { cwd: project, env });
  age(sessions, 'stale', hoursAgo(8 * 24));
  age(sessions, 'active', hoursAgo(8 * 24));
  // Used yesterday by the old bash script, which touched only the log.
  utimesSync(path.join(sessions, 'active.md'), hoursAgo(24), hoursAgo(24));
  writeFileSync(path.join(sessions, 'orphan.md'), 'old log\n');
  utimesSync(path.join(sessions, 'orphan.md'), hoursAgo(9 * 24), hoursAgo(9 * 24));

  assert.equal(askRepo(['-a', 'web', 'q'], { cwd: project, env }).status, 0);
  assert.equal(askRepo(['-n', 'x', 'web', 'q'], { cwd: project, env }).status, 0);
  assert.deepEqual(readdirSync(sessions).sort(), ['active.id', 'active.md', 'x.id', 'x.md']);
});

test('a bad session name is a usage error', (t) => {
  const { project, env } = setupWithAlias(t);
  assert.equal(askRepo(['-n', '../x', 'web', 'q'], { cwd: project, env }).status, 64);
  assert.equal(askRepo(['-n', '.hidden', 'web', 'q'], { cwd: project, env }).status, 64);
});

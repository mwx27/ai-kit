// The Stop gate (hooks/stop-gate.mjs → core/gate.mjs), run as Claude Code runs it: a session that
// started on a fixture whose docs pass docs-check, changes files through its tool-call hooks
// (core/attribution.mjs), then stops; the plugin's real docs-check, then a guard that lives outside
// the repo and passes or fails with whatever output the test hands it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN_ROOT, agentSession, docsBaseline, escapeRegExp, eventLog, git, readJson, readLines, runHook, sessionPath, tmpRepo, writeDocsRule, writeFiles } from './helpers.mjs';

const SESSION = 'gate-session';
const STATE = `artifacts/claude-hooks/honest-docs/${SESSION}/state.json`;
const GATE_LOG = `artifacts/logs/guard-gate-${SESSION}.log`;

/** Records every call to GUARD_RECORD, prints GUARD_OUTPUT, exits GUARD_EXIT. */
const GUARD = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.GUARD_RECORD, JSON.stringify({ args: process.argv.slice(2), scripts: process.env.HONEST_DOCS_SCRIPTS, cwd: process.cwd() }) + '\\n');
process.stdout.write(process.env.GUARD_OUTPUT ?? '');
process.exit(Number(process.env.GUARD_EXIT ?? 0));
`;

/**
 * The C3 path: a guard that runs docs-check itself, as the template's guard.sh does, before failing
 * or passing like GUARD.
 */
const DOCS_GUARD = `import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.GUARD_RECORD, JSON.stringify({ args: process.argv.slice(2) }) + '\\n');
const docs = spawnSync(process.execPath, [process.env.HONEST_DOCS_SCRIPTS + '/docs-check.mjs'], { encoding: 'utf8' });
if (docs.status !== 0) {
  process.stdout.write('=== Error details ===\\n' + docs.stdout + docs.stderr + 'GUARD_FAIL check=docs\\n');
  process.exit(1);
}
process.stdout.write(process.env.GUARD_OUTPUT ?? '');
process.exit(Number(process.env.GUARD_EXIT ?? 0));
`;

/**
 * A repo whose docs pass docs-check, with a guard configured (`guard: null` for none, `'docs'` for
 * DOCS_GUARD), and a session started on it: `write()` changes a file through the Write tool,
 * `editor()` as the user's editor does, `stop()` ends a turn and `calls()` shows what the guard got.
 */
function project(t, { config, files = {}, guard: guardKind = 'plain', start = true } = {}) {
  const { dir, root } = tmpRepo(t, {
    ...docsBaseline(),
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': 'export const b = 1;\n',
    ...files,
  });
  const guard = path.join(dir, 'guard.mjs');
  const record = path.join(dir, 'guard-calls.jsonl');
  writeFileSync(guard, guardKind === 'docs' ? DOCS_GUARD : GUARD);
  writeDocsRule(root);
  writeFiles(root, {
    '.claude/honest-docs.json': JSON.stringify(config ?? (guardKind === null ? {} : { guard: { command: ['node', guard] } })),
  });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'config');
  const session = agentSession(root, SESSION);
  if (start) session.start();

  const stop = ({ exit = 0, output = '', payload = {}, env = {} } = {}) => {
    const run = runHook(
      'stop-gate',
      { session_id: SESSION, cwd: root, hook_event_name: 'Stop', permission_mode: 'default', stop_hook_active: false, ...payload },
      { root, env: { GUARD_RECORD: record, GUARD_EXIT: String(exit), GUARD_OUTPUT: output, ...env } }
    );
    return { ...run, message: run.stdout ? JSON.parse(run.stdout).systemMessage : undefined };
  };
  const calls = () => (existsSync(record) ? readLines(record).map((line) => JSON.parse(line)) : []);
  const state = () => readJson(path.join(root, STATE));
  const gateLog = () => readLines(path.join(root, GATE_LOG));
  const hash = (file) => git(root, 'hash-object', file).trim();
  const write = (file, text) => session.write(file, text);
  const editor = (file, text) => writeFiles(root, { [file]: text });
  return { dir, root, guard, session, stop, calls, state, gateLog, hash, write, editor };
}

const FAIL_OUTPUT = 'eslint: 1 error\n=== Error details ===\nsrc/a.ts:1 no-unused-vars\nGUARD_FAIL check=eslint files=1\n';

test('pass: the guard gets the changed files, the gate records them as verified', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');

  const run = p.stop();
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.match(run.message, /^docs-check, guard --changed: 1 file, \d+\.\ds$/);

  const [call] = p.calls();
  assert.deepEqual(call.args, ['--changed', 'src/a.ts']);
  assert.equal(call.scripts, path.join(PLUGIN_ROOT, 'scripts'));
  assert.equal(call.cwd, p.root);

  const state = p.state();
  assert.equal(state.version, 2);
  assert.equal(state.session_id, SESSION);
  assert.deepEqual(state.verified, { 'src/a.ts': p.hash('src/a.ts') });
  assert.deepEqual(state.gaveUp, {});
  assert.equal(state.failure, undefined);
  assert.match(p.gateLog()[0], /^\S+Z {2}ran {2}changed=1 checked=1 {2}ms=\d+ {2}pass$/);
});

test('pass: the next stop on the same content runs nothing', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  p.stop();
  const run = p.stop();
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.equal(p.calls().length, 1);
  assert.match(p.gateLog()[1], / {2}skipped {2}changed=1 checked=0 {2}ms=\d+ {2}- {2}nothing-new$/);
});

test('pass: the message agrees with the number of files', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  p.write('src/b.ts', 'export const b = 2;\n');
  assert.match(p.stop().message, /^docs-check, guard --changed: 2 files, /);
});

test('nothing attributed runs nothing, even with a dirty tree and a broken doc', (t) => {
  const p = project(t);
  p.editor('src/a.ts', 'export const a = 2;\n');
  p.editor('_docs/doc.md', BROKEN_DOC);
  p.session.bash(); // A Bash call that changed nothing.
  const run = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.equal(p.calls().length, 0);
  assert.match(p.gateLog()[0], / {2}skipped {2}changed=0 checked=0 {2}ms=\d+ {2}- {2}nothing-attributed$/);
  // The one docs-check run is the SessionStart's.
  assert.equal(eventLog(p.root).filter((e) => e.event === 'docs-check').length, 1);
});

test('fail with GUARD_FAIL check=docs from the guard: blocks and points at honest-docs-check', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 1, output: 'links (1)\n  _docs/x.md:3  no such file: y.md\nGUARD_FAIL check=docs\n' });

  assert.equal(run.status, 2);
  // The '' separators in core/gate.mjs fall to .filter(Boolean), so no blank lines — as in the template.
  assert.equal(
    run.stderr,
    'Guard gate: docs failed on 1 changed file(s).\n' +
      '  src/a.ts\n' +
      '    links (1)\n' +
      '      _docs/x.md:3  no such file: y.md\n' +
      'Fix it and stop again. To reproduce: honest-docs-check\n'
  );
  assert.match(run.message, /^docs-check, guard --changed: 1 file, /);
  assert.equal(p.state().failure.check, 'docs');
  assert.equal(p.state().failure.repeats, 1);
  assert.deepEqual(p.state().verified, {});
  assert.match(p.gateLog()[0], / {2}ran {2}changed=1 checked=1 {2}ms=\d+ {2}fail {2}docs$/);
});

test('fail without GUARD_FAIL: the check is "guard" and the reproduce line is the guard command', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 3, output: 'something broke\n' });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Guard gate: guard failed on 1 changed file\(s\)\.\n {2}src\/a\.ts\n {4}something broke\n/);
  assert.ok(run.stderr.endsWith(`To reproduce: node ${p.guard} --changed src/a.ts\n`), run.stderr);
  assert.equal(p.state().failure.check, 'guard');
});

test('fail: only the error details reach the agent, at most 12 lines', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const details = Array.from({ length: 20 }, (_, i) => `detail ${i + 1}`).join('\n');
  const run = p.stop({ exit: 1, output: `noise before\n=== Error details ===\n${details}\nGUARD_FAIL check=tsc\nsrc/a.ts\n` });

  assert.doesNotMatch(run.stderr, /noise before/);
  assert.match(run.stderr, / {4}detail 12\n/);
  assert.doesNotMatch(run.stderr, /detail 13/);
});

test('the third identical failure lets the stop through and records gaveUp', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');

  const first = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(first.status, 2);
  assert.doesNotMatch(first.stderr, /One more identical failure/);

  const second = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /One more identical failure and the gate gives up and lets the stop through\.\n$/);
  assert.equal(p.state().failure.repeats, 2);

  const third = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(third.status, 0);
  assert.equal(third.stderr, '');
  assert.match(
    third.message,
    new RegExp(
      `^docs-check, guard --changed: 1 file, \\d+\\.\\ds - eslint still fails after 3 identical attempts, letting the stop through\\. ` +
        `Nothing was fixed; run \`node ${escapeRegExp(p.guard)}\` to see it\\.$`
    )
  );

  const state = p.state();
  assert.deepEqual(state.gaveUp, { 'src/a.ts': p.hash('src/a.ts') });
  assert.deepEqual(state.verified, {});
  assert.equal(state.failure, undefined);
  assert.match(p.gateLog()[2], / {2}ran {2}changed=1 checked=1 {2}ms=\d+ {2}giveup {2}eslint$/);

  // The concession holds for this content only: the next stop skips it, an edit brings it back.
  assert.equal(p.stop({ exit: 1, output: FAIL_OUTPUT }).stdout, '');
  assert.equal(p.calls().length, 3);
  p.write('src/a.ts', 'export const a = 3;\n');
  assert.equal(p.stop({ exit: 1, output: FAIL_OUTPUT }).status, 2);
});

test('giving up on check=docs points at honest-docs-check', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  for (let i = 0; i < 2; i++) p.stop({ exit: 1, output: 'GUARD_FAIL check=docs\n' });
  const run = p.stop({ exit: 1, output: 'GUARD_FAIL check=docs\n' });
  assert.equal(run.status, 0);
  assert.match(run.message, /run `honest-docs-check` to see it\.$/);
});

test('failures that differ only in timings, colour and log stamps count as identical', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  p.stop({ exit: 1, output: 'tsc failed (12s) log 20260101_101010\n' });
  p.stop({ exit: 1, output: '\u001b[31mtsc failed\u001b[0m (3s) log 20260102_111111\n' });
  assert.equal(p.stop({ exit: 1, output: 'tsc failed (40s) log 20260103_121212\n' }).status, 0);
});

test('stop_hook_active: true does not disarm the gate, the repeat count grows as with false', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  assert.equal(p.stop({ exit: 1, output: FAIL_OUTPUT }).status, 2);
  assert.equal(p.state().failure.repeats, 1);

  const run = p.stop({ exit: 1, output: FAIL_OUTPUT, payload: { stop_hook_active: true } });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Guard gate: eslint failed on 1 changed file\(s\)\./);
  assert.equal(p.state().failure.repeats, 2);
  assert.equal(p.calls().length, 2);
});

test('different failures in the same file keep blocking', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  for (let i = 1; i <= 4; i++) {
    const run = p.stop({ exit: 1, output: `src/a.ts:${i} error ${i}\nGUARD_FAIL check=eslint\n` });
    assert.equal(run.status, 2, `stop ${i}`);
    assert.equal(p.state().failure.repeats, 1);
  }
  assert.deepEqual(p.state().gaveUp, {});
});

test('GUARD_ERROR: the stop goes through, the user is told, the files stay unverified', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  p.write('src/b.ts', 'export const b = 2;\n');
  const run = p.stop({ exit: 1, output: 'booting the simulator\nGUARD_ERROR reason=simulator not running\n' });

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.match(
    run.message,
    /^docs-check, guard --changed: 2 files, \d+\.\ds - the guard could not check \(simulator not running\): 2 files unverified, checked again at the next stop\.$/
  );
  // Nothing is recorded: no state file, so nothing verified and no failure counted.
  assert.equal(existsSync(path.join(p.root, STATE)), false);
  assert.match(p.gateLog()[0], / {2}ran {2}changed=2 checked=2 {2}ms=\d+ {2}unchecked {2}simulator not running$/);

  // The next stop checks the same files again, and a pass then records them.
  assert.equal(p.stop().status, 0);
  assert.equal(p.calls().length, 2);
  assert.deepEqual(p.calls()[1].args, ['--changed', 'src/a.ts', 'src/b.ts']);
  assert.deepEqual(Object.keys(p.state().verified).sort(), ['src/a.ts', 'src/b.ts']);
});

test('GUARD_ERROR is never a failure: it does not count toward giving up', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  for (let i = 0; i < 4; i++) {
    const run = p.stop({ exit: 1, output: 'GUARD_ERROR reason=no network\n' });
    assert.equal(run.status, 0, `stop ${i + 1}`);
    assert.match(run.message, /1 file unverified/);
  }
  assert.equal(p.calls().length, 4);
  assert.equal(existsSync(path.join(p.root, STATE)), false);
});

test('GUARD_ERROR after a failure leaves the failure count as it was', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(p.stop({ exit: 1, output: 'GUARD_ERROR reason=no network\n' }).status, 0);
  assert.equal(p.state().failure.repeats, 1);
  assert.deepEqual(p.state().verified, {});
});

test('GUARD_ERROR beside GUARD_FAIL: the failure wins and blocks', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 1, output: 'GUARD_ERROR reason=half the checks skipped\nGUARD_FAIL check=tsc\n' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Guard gate: tsc failed on 1 changed file\(s\)\./);
  assert.equal(p.state().failure.check, 'tsc');
  assert.match(p.gateLog()[0], / {2}fail {2}tsc$/);
});

test('GUARD_ERROR with exit 0 is a pass', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 0, output: 'GUARD_ERROR reason=ignored\n' });
  assert.equal(run.status, 0);
  assert.match(run.message, /^docs-check, guard --changed: 1 file, \d+\.\ds$/);
  assert.deepEqual(p.state().verified, { 'src/a.ts': p.hash('src/a.ts') });
});

test('GUARD_ERROR without a reason, and its event log line', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 3, output: 'GUARD_ERROR reason=\n' });
  assert.equal(run.status, 0);
  assert.match(run.message, /could not check \(no reason given\)/);
  const gate = eventLog(p.root).find((e) => e.event === 'gate');
  assert.equal(gate.outcome, 'unchecked');
  assert.equal(gate.reason, 'no reason given');
});

test('permission_mode=plan: never runs the guard, never blocks', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 1, output: FAIL_OUTPUT, payload: { permission_mode: 'plan' } });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.equal(p.calls().length, 0);
  assert.equal(existsSync(path.join(p.root, STATE)), false);
  assert.match(p.gateLog()[0], / {2}skipped {2}changed=0 checked=0 {2}ms=\d+ {2}- {2}plan-mode$/);
});

const LAST_UPDATED_DOC = '# Doc\n\n**Last Updated:** 2000-01-01 00:00 CET\n\nText.\n';
const MTIME = new Date('2026-01-15T09:30:00Z'); // 10:30 CET in Warsaw

const BROKEN_DOC = '# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\nSee [gone](gone.md).\n';
const GOOD_DOC = '# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\nSee [it](doc.md).\n';

test('no guard.command: a link the session breaks blocks, as check docs, listing it and the command', (t) => {
  const p = project(t, { guard: null, files: { '_docs/doc.md': GOOD_DOC } });
  p.write('_docs/doc.md', BROKEN_DOC);

  const run = p.stop();
  assert.equal(run.status, 2);
  assert.equal(
    run.stderr,
    'Guard gate: docs failed on 1 changed file(s).\n' +
      '  _docs/doc.md\n' +
      '    _docs/doc.md:5  no such file: gone.md\n' +
      'Fix it and stop again. To reproduce: honest-docs-check\n'
  );
  assert.ok(run.stderr.endsWith('Fix it and stop again. To reproduce: honest-docs-check\n'), run.stderr);
  assert.match(run.message, /^docs-check: 1 file, \d+\.\ds$/);
  assert.equal(p.state().failure.check, 'docs');
  assert.deepEqual(p.state().verified, {});
  assert.match(p.gateLog()[0], / {2}ran {2}changed=1 checked=1 {2}ms=\d+ {2}fail {2}docs$/);
});

test('no guard.command: the third identical docs failure gives up and points at honest-docs-check', (t) => {
  const p = project(t, { guard: null, files: { '_docs/doc.md': GOOD_DOC } });
  p.write('_docs/doc.md', BROKEN_DOC);
  assert.equal(p.stop().status, 2);
  assert.equal(p.stop().status, 2);
  const run = p.stop();
  assert.equal(run.status, 0);
  assert.match(run.message, /^docs-check: 1 file, \d+\.\ds - docs still fails after 3 identical attempts, .*run `honest-docs-check` to see it\.$/);
  assert.deepEqual(p.state().gaveUp, { '_docs/doc.md': p.hash('_docs/doc.md') });
  // A give-up adds nothing to the start set: the problem stays new to this session.
  assert.deepEqual(readJson(sessionPath(p.root, SESSION, 'start.json')).problems, []);
});

test('no guard.command: clean docs pass, the doc is stamped and verified', (t) => {
  const p = project(t, { guard: null, config: { timeZone: 'Europe/Warsaw' }, files: { '_docs/doc.md': LAST_UPDATED_DOC } });
  const doc = path.join(p.root, '_docs/doc.md');
  p.write('_docs/doc.md', `${LAST_UPDATED_DOC}More.\n`);
  utimesSync(doc, MTIME, MTIME);

  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.match(run.message, /^docs-check: 1 file, \d+\.\ds$/);
  assert.equal(readFileSync(doc, 'utf8'), '# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\nText.\nMore.\n');
  assert.deepEqual(p.state().verified, { '_docs/doc.md': p.hash('_docs/doc.md') });
  assert.equal(p.calls().length, 0);
  assert.match(p.gateLog()[0], / {2}ran {2}changed=1 checked=1 {2}ms=\d+ {2}pass {2}docs-check-only$/);
  assert.equal(p.stop().stdout, '');
});

test('with guard.command: docs-check fails first, so the guard never runs', (t) => {
  const p = project(t, { files: { '_docs/doc.md': GOOD_DOC } });
  p.write('_docs/doc.md', BROKEN_DOC);
  const run = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Guard gate: docs failed on 1 changed file\(s\)\./);
  assert.match(run.message, /^docs-check: 1 file, /);
  assert.equal(p.calls().length, 0);
  assert.equal(p.state().failure.check, 'docs');
});

test('with guard.command: docs pass and the guard fails, so it blocks with the guard\'s check', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Guard gate: eslint failed on 1 changed file\(s\)\./);
  assert.match(run.message, /^docs-check, guard --changed: 1 file, /);
  assert.equal(p.calls().length, 1);
  assert.match(p.gateLog()[0], / {2}fail {2}eslint$/);
});

// C3: a guard written for 0.1.0 runs docs-check itself, as the template's guard.sh does. It keeps
// working: docs-check runs twice when the docs pass, and the gate's own run catches them first when not.
test('old path: a guard that runs docs-check itself passes on clean docs', (t) => {
  const p = project(t, { guard: 'docs' });
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.message, /^docs-check, guard --changed: 1 file, /);
  assert.deepEqual(p.calls()[0].args, ['--changed', 'src/a.ts']);
  assert.deepEqual(p.state().verified, { 'src/a.ts': p.hash('src/a.ts') });
  assert.match(p.gateLog()[0], / {2}pass$/);
});

test('old path: a guard that runs docs-check itself blocks with its own check', (t) => {
  const p = project(t, { guard: 'docs' });
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop({ exit: 1, output: FAIL_OUTPUT });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Guard gate: eslint failed on 1 changed file\(s\)\./);
  assert.equal(p.state().failure.check, 'eslint');
});

test('old path: broken docs block as check docs before the guard runs', (t) => {
  const p = project(t, { guard: 'docs', files: { '_docs/doc.md': GOOD_DOC } });
  p.write('_docs/doc.md', BROKEN_DOC);
  const run = p.stop();
  assert.equal(run.status, 2);
  assert.ok(run.stderr.endsWith('To reproduce: honest-docs-check\n'), run.stderr);
  assert.equal(p.calls().length, 0);
  assert.equal(p.state().failure.check, 'docs');
});

test('Last Updated is stamped from the mtime, in the configured zone, and the mtime is kept', (t) => {
  const p = project(t, { files: { '_docs/doc.md': LAST_UPDATED_DOC } });
  writeFiles(p.root, {
    '.claude/honest-docs.json': JSON.stringify({ timeZone: 'Europe/Warsaw', guard: { command: ['node', p.guard] } }),
  });
  git(p.root, 'commit', '-q', '-am', 'zone');
  const doc = path.join(p.root, '_docs/doc.md');
  p.write('_docs/doc.md', `${LAST_UPDATED_DOC}More.\n`);
  utimesSync(doc, MTIME, MTIME);

  const run = p.stop();
  assert.equal(run.status, 0);
  assert.equal(readFileSync(doc, 'utf8'), '# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\nText.\nMore.\n');
  assert.equal(statSync(doc).mtimeMs, MTIME.getTime());
  // verified holds the stamped content, so the next stop does not take the stamp for a new edit.
  assert.deepEqual(p.state().verified, { '_docs/doc.md': p.hash('_docs/doc.md') });
  assert.equal(p.stop().stdout, '');
  assert.equal(p.calls().length, 1);
});

test('a doc already carrying its stamp is not rewritten', (t) => {
  const p = project(t, { files: { '_docs/doc.md': LAST_UPDATED_DOC } });
  writeFiles(p.root, {
    '.claude/honest-docs.json': JSON.stringify({ timeZone: 'Europe/Warsaw', guard: { command: ['node', p.guard] } }),
  });
  git(p.root, 'commit', '-q', '-am', 'zone');
  const doc = path.join(p.root, '_docs/doc.md');
  const text = '# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\nNew text.\n';
  p.write('_docs/doc.md', text);
  utimesSync(doc, MTIME, MTIME);
  const before = statSync(doc).ctimeMs;

  p.stop();
  assert.equal(readFileSync(doc, 'utf8'), text);
  assert.equal(statSync(doc).ctimeMs, before);
});

test('stateDir, logDir and the copy folder are never attributed, whatever .gitignore says', (t) => {
  const p = project(t);
  // The fixture has no .gitignore: the folders show up as untracked in git status.
  p.write('artifacts/claude-hooks/note.md', 'x\n');
  p.write('artifacts/logs/note.md', 'x\n');
  p.write('.claude/honest-docs/note.md', 'x\n');
  p.session.bash(() => p.editor('artifacts/logs/other.md', 'x\n'));
  assert.ok(git(p.root, 'status', '--porcelain', '--untracked-files=all').includes('artifacts/'));
  assert.equal(p.stop().stdout, '');
  assert.match(p.gateLog()[0], / {2}nothing-attributed$/);

  p.write('src/a.ts', 'export const a = 2;\n');
  p.stop();
  assert.deepEqual(p.calls()[0].args, ['--changed', 'src/a.ts']);
});

test('custom stateDir and logDir are excluded too', (t) => {
  const p = project(t);
  writeFiles(p.root, {
    '.claude/honest-docs.json': JSON.stringify({ stateDir: 'tmp/state/', logDir: 'tmp/logs', guard: { command: ['node', p.guard] } }),
  });
  git(p.root, 'commit', '-q', '-am', 'dirs');
  p.write('src/a.ts', 'export const a = 2;\n');
  p.stop();
  assert.ok(existsSync(path.join(p.root, `tmp/state/honest-docs/${SESSION}/state.json`)));
  assert.ok(existsSync(path.join(p.root, `tmp/logs/guard-gate-${SESSION}.log`)));
  assert.equal(p.stop().stdout, '');
  assert.equal(p.calls().length, 1);
});

test('a guard that cannot be started lets the stop through', (t) => {
  const p = project(t);
  writeFiles(p.root, { '.claude/honest-docs.json': JSON.stringify({ guard: { command: ['/nonexistent/guard'] } }) });
  git(p.root, 'commit', '-q', '-am', 'broken guard');
  p.write('src/a.ts', 'export const a = 2;\n');
  const run = p.stop();
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.match(p.gateLog()[0], / {2}ran {2}changed=1 checked=1 {2}ms=\d+ {2}error {2}ENOENT$/);
});

test('outside a git repo the gate passes in silence', (t) => {
  const p = project(t);
  writeFiles(p.dir, { '.claude/honest-docs.json': JSON.stringify({ guard: { command: ['node', p.guard] } }) });
  const run = runHook('stop-gate', { session_id: SESSION }, { root: p.dir });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.equal(p.calls().length, 0);
  assert.match(readFileSync(path.join(p.dir, GATE_LOG), 'utf8'), / {2}- {2}nothing-attributed\n$/);
});

/** Ends a turn with the event log on, and returns the gate's own events. */
function stopLogged(p, options = {}) {
  const run = p.stop(options);
  return { run, gateEvents: eventLog(p.root).filter((e) => e.event === 'gate') };
}

for (const [label, text, detail] of [
  ['not valid JSON', '{ not json', /not valid JSON \(/],
  ['not a JSON object', '["node", "guard.mjs"]', /not a JSON object/],
  ['a string in guard.command', '{ "guard": { "command": "bash scripts/guard.sh" } }', /guard\.command must be an array of strings/],
  ['an empty guard.command', '{ "guard": { "command": [] } }', /guard\.command must be an array of strings/],
  ['a number in guard.command', '{ "guard": { "command": ["node", 1] } }', /guard\.command must be an array of strings/],
  ['a string in guard', '{ "guard": "bash scripts/guard.sh" }', /guard must be an object, like/],
]) {
  test(`a config that is ${label}: the stop goes through, and the gate says it checked nothing`, (t) => {
    const p = project(t);
    p.write('.claude/honest-docs.json', text);
    p.write('src/a.ts', 'export const a = 2;\n');
    const { run, gateEvents } = stopLogged(p, { exit: 1, output: FAIL_OUTPUT });

    assert.equal(run.status, 0);
    assert.equal(run.stderr, '');
    assert.match(run.message, /^honest-docs: \.claude\/honest-docs\.json: /);
    assert.match(run.message, detail);
    assert.match(run.message, /The Stop gate checked nothing this turn\.$/);
    assert.equal(p.calls().length, 0);
    assert.deepEqual(gateEvents.map((e) => [e.outcome, e.reason]), [['-', 'config-error']]);
  });
}

for (const config of [{}, { guard: null }, { guard: { command: null } }]) {
  test(`guard as ${JSON.stringify(config)}: no guard, docs-check alone`, (t) => {
    const p = project(t, { config });
    p.write('src/a.ts', 'export const a = 2;\n');
    const run = p.stop({ exit: 1, output: FAIL_OUTPUT });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.message, /^docs-check: 1 file, /);
    assert.equal(p.calls().length, 0);
    assert.match(p.gateLog()[0], / {2}pass {2}docs-check-only$/);
  });
}

test('any other internal error is reported too, without blocking', (t) => {
  const p = project(t);
  // Not validated: a number where a path belongs breaks the gate further in, not as a config error.
  p.write('.claude/honest-docs.json', '{ "docsDir": 5 }');
  p.write('src/a.ts', 'export const a = 2;\n');
  const { run, gateEvents } = stopLogged(p);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.match(run.message, /^honest-docs: the Stop gate failed \(.+\) and checked nothing this turn\.$/);
  assert.match(gateEvents[0].reason, /^internal-error: /);
});

test('an unreadable payload exits 0', (t) => {
  const p = project(t);
  const run = runHook('stop-gate', undefined, { root: p.root });
  assert.equal(run.status, 0);
  assert.match(readFileSync(path.join(p.root, 'artifacts/logs/guard-gate-unknown.log'), 'utf8'), /skipped .* no-input\n$/);
});

// "Don't make it worse": only a problem new against the start set and caused by the session blocks.

const dated = (body) => `# Doc\n\n**Last Updated:** 2026-01-15 10:30 CET\n\n${body}\n`;

test('a second session whose one Bash changed nothing is not blocked by the first session\'s broken link', (t) => {
  const p = project(t, { guard: null, files: { '_docs/doc.md': GOOD_DOC } });
  const other = agentSession(p.root, 'session-b');
  other.start();
  p.write('_docs/doc.md', BROKEN_DOC);
  other.bash();

  const runs = () => eventLog(p.root).filter((e) => e.event === 'docs-check').length;
  const before = runs();
  const b = runHook('stop-gate', { session_id: 'session-b', cwd: p.root, permission_mode: 'default' }, { root: p.root });
  assert.deepEqual([b.status, b.stdout, b.stderr], [0, '', '']);
  assert.equal(runs(), before);
  assert.equal(p.stop().status, 2);
});

test('an editor edit that breaks a link does not block; the user is told of the new problem', (t) => {
  const p = project(t, { guard: null, files: { '_docs/doc.md': GOOD_DOC } });
  p.write('src/a.ts', 'export const a = 2;\n');
  p.editor('_docs/doc.md', BROKEN_DOC);

  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.match(run.message, /^docs-check: 1 file, \d+\.\ds - 1 new docs problem not from this session \(`honest-docs-check` lists them\)$/);
});

test('a problem from before the session in a doc the session edits does not block', (t) => {
  const p = project(t, { guard: null, files: { '_docs/doc.md': BROKEN_DOC } });
  p.write('_docs/doc.md', `${BROKEN_DOC}More.\n`);
  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.message, /^docs-check: 1 file, \d+\.\ds$/);
  // A second occurrence of the same problem is new.
  p.write('_docs/doc.md', `${BROKEN_DOC}And [gone](gone.md).\n`);
  // The later one in the doc is the one shown.
  assert.match(p.stop().stderr, /\n {4}_docs\/doc\.md:6 {2}no such file: gone\.md\n/);
});

for (const [label, files, act, line] of [
  [
    'deleting a file an unattributed doc names',
    { '_docs/doc.md': dated('See `src/x.ts`.'), 'src/x.ts': '1\n' },
    (p) => p.session.bash(() => rmSync(path.join(p.root, 'src/x.ts'))),
    '_docs/doc.md:5  no such path: src/x.ts',
  ],
  [
    'deleting the file a doc names as an import specifier',
    { '_docs/doc.md': dated('See `hooks/useAnalytics`.'), 'hooks/useAnalytics.ts': '1\n' },
    (p) => p.session.bash(() => rmSync(path.join(p.root, 'hooks/useAnalytics.ts'))),
    '_docs/doc.md:5  no such path: hooks/useAnalytics',
  ],
  [
    'renaming a heading another doc links to',
    { '_docs/a.md': dated('See [setup](b.md#setup).'), '_docs/b.md': dated('## Setup') },
    (p) => p.write('_docs/b.md', dated('## Install')),
    '_docs/a.md:5  no heading "#setup" in b.md',
  ],
  [
    'dropping a script a doc runs from package.json',
    { 'package.json': '{ "name": "fixture", "scripts": { "build": "x" } }\n', '_docs/doc.md': dated('Run `npm run build`.') },
    (p) => p.write('package.json', '{ "name": "fixture" }\n'),
    '_docs/doc.md:5  no npm script: build',
  ],
  [
    'adding a page the docs index does not list',
    {},
    (p) => p.write('_docs/features/new.md', dated('New.')),
    'CLAUDE.md  page missing from the docs index: _docs/features/new.md',
  ],
  [
    'deleting the only file a covers glob matched',
    { '_docs/doc.md': `---\ncovers:\n  - 'lib/only.ts'\n---\n\n${dated('Text.')}`, 'lib/only.ts': '1\n' },
    (p) => p.session.bash(() => rmSync(path.join(p.root, 'lib/only.ts'))),
    '_docs/doc.md  covers matches no file: lib/only.ts',
  ],
  [
    'a config change that brings a broken doc into the scan',
    { 'docs/x.md': BROKEN_DOC },
    (p) => p.write('.claude/honest-docs.json', JSON.stringify({ docsDir: 'docs' })),
    'docs/x.md:5  no such file: gone.md',
  ],
]) {
  test(`caused by the session: ${label} blocks`, (t) => {
    const p = project(t, { guard: null, files });
    act(p);
    const run = p.stop();
    assert.equal(run.status, 2, run.stdout);
    assert.ok(run.stderr.includes(`\n    ${line}\n`), run.stderr);
  });
}

test('Last Updated: an attributed doc is restamped, a doc changed only in the editor is not', (t) => {
  const p = project(t, { guard: null, config: { timeZone: 'Europe/Warsaw' }, files: { '_docs/a.md': LAST_UPDATED_DOC, '_docs/b.md': LAST_UPDATED_DOC } });
  p.write('_docs/a.md', `${LAST_UPDATED_DOC}More.\n`);
  p.editor('_docs/b.md', `${LAST_UPDATED_DOC}More.\n`);
  for (const doc of ['_docs/a.md', '_docs/b.md']) utimesSync(path.join(p.root, doc), MTIME, MTIME);

  assert.equal(p.stop().status, 0);
  assert.match(readFileSync(path.join(p.root, '_docs/a.md'), 'utf8'), /2026-01-15 10:30 CET/);
  assert.equal(readFileSync(path.join(p.root, '_docs/b.md'), 'utf8'), `${LAST_UPDATED_DOC}More.\n`);
});

test('a turn that only deletes a file runs the checks and records it as verified deleted', (t) => {
  const p = project(t, { guard: null, files: { 'src/old.ts': '1\n' } });
  p.session.bash(() => rmSync(path.join(p.root, 'src/old.ts')));
  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.match(p.gateLog()[0], / {2}ran {2}changed=1 checked=1 .* pass {2}docs-check-only$/);
  assert.deepEqual(p.state().verified, { 'src/old.ts': null });
  assert.equal(p.stop().stdout, '');
  assert.match(p.gateLog()[1], / {2}nothing-new$/);
});

test('guard --changed gets only the attributed files still on disk', (t) => {
  const p = project(t);
  p.write('src/a.ts', 'export const a = 2;\n');
  p.session.bash(() => rmSync(path.join(p.root, 'src/b.ts')));
  p.editor('src/c.ts', 'export const c = 1;\n');
  assert.equal(p.stop().status, 0);
  assert.deepEqual(p.calls()[0].args, ['--changed', 'src/a.ts']);
});

test('Pre files older than 15 minutes are removed at Stop, newer ones kept', (t) => {
  const p = project(t);
  const pre = (name) => sessionPath(p.root, SESSION, `pre/${name}.json`);
  writeFiles(p.root, { [path.relative(p.root, pre('old'))]: '{}', [path.relative(p.root, pre('new'))]: '{}' });
  const old = new Date(Date.now() - 16 * 60 * 1000);
  utimesSync(pre('old'), old, old);
  p.stop();
  assert.equal(existsSync(pre('old')), false);
  assert.equal(existsSync(pre('new')), true);
});

test('no start set (hooks added mid-session): the first stop takes one and does not block, the next new problem does', (t) => {
  const p = project(t, { guard: null, start: false, files: { '_docs/doc.md': BROKEN_DOC } });
  p.write('_docs/doc.md', `${BROKEN_DOC}More.\n`);
  const first = p.stop();
  assert.equal(first.status, 0, first.stderr);
  assert.match(p.gateLog()[0], / {2}pass {2}docs-check-only start-set-at-stop$/);
  const start = readJson(sessionPath(p.root, SESSION, 'start.json'));
  assert.equal(start.taken_by, 'stop');
  assert.deepEqual(start.problems, [{ check: 'links', file: '_docs/doc.md', message: 'no such file: gone.md', count: 1 }]);

  p.write('_docs/doc.md', `${BROKEN_DOC}More, see [lost](lost.md).\n`);
  const second = p.stop();
  assert.equal(second.status, 2);
  assert.match(second.stderr, /\n {4}_docs\/doc\.md:6 {2}no such file: lost\.md\n/);
  assert.doesNotMatch(second.stderr, /gone\.md/);
});

test('a start set taken by another code version is renewed at the stop, which does not block on the docs', (t) => {
  const p = project(t, { guard: null, files: { '_docs/doc.md': GOOD_DOC } });
  const file = sessionPath(p.root, SESSION, 'start.json');
  writeFileSync(file, JSON.stringify({ ...readJson(file), version: '0.0.1' }));
  p.write('_docs/doc.md', BROKEN_DOC);

  const run = p.stop();
  assert.equal(run.status, 0, run.stderr);
  assert.match(p.gateLog()[0], / {2}pass {2}docs-check-only start-set-renewed$/);
  assert.equal(readJson(file).version, JSON.parse(readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json'), 'utf8')).version);
  assert.equal(readJson(file).problems.length, 1);
});

// The shared event log (core/log.mjs): nothing without CLAUDE_PLUGIN_DATA; with it, one JSON line per
// event carrying the fields its header lists, metadata only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { logEvent } from '../core/log.mjs';
import { PLUGIN_ROOT, PLUGIN_VERSION, readLines, runBin, runHook, tmpRepo } from './helpers.mjs';

const HEADER_FIELDS = ['ts', 'event', 'pluginVersion', 'project', 'pluginRoot'];

const events = (data) => {
  const file = path.join(data, 'events.jsonl');
  return existsSync(file) ? readLines(file).map((line) => JSON.parse(line)) : [];
};

/** logEvent in this process with CLAUDE_PLUGIN_DATA set to `value` (or unset), restored afterwards. */
function withPluginData(value, fn) {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  if (value === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
  else process.env.CLAUDE_PLUGIN_DATA = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = saved;
  }
}

test('without CLAUDE_PLUGIN_DATA nothing is written', (t) => {
  const { dir, root } = tmpRepo(t);
  const before = readdirSync(dir);
  withPluginData(undefined, () => logEvent(root, 'probe', { n: 1 }));
  assert.deepEqual(readdirSync(dir), before);
  assert.deepEqual(readdirSync(root).sort(), ['.git', '.gitkeep']);
});

test('without CLAUDE_PLUGIN_DATA the hooks and scripts write no event log either', (t) => {
  const { dir, root } = tmpRepo(t, { 'package.json': '{}', 'CLAUDE.md': '# x\n' });
  runHook('session-baseline', { session_id: 's' }, { root });
  runBin('honest-docs-grep', ['x'], { cwd: root });
  assert.equal(existsSync(path.join(root, 'events.jsonl')), false);
  assert.deepEqual(readdirSync(dir), ['repo']);
});

test('with it: one line with the header fields first, then the metadata', (t) => {
  const { dir, root } = tmpRepo(t);
  const data = path.join(dir, 'data', 'nested');
  withPluginData(data, () => {
    logEvent(root, 'probe', { n: 1, outcome: 'pass' });
    logEvent(root, 'probe', { n: 2 });
  });

  const [first, second] = events(data);
  assert.deepEqual(Object.keys(first), [...HEADER_FIELDS, 'n', 'outcome']);
  assert.match(first.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(first.event, 'probe');
  assert.equal(first.pluginVersion, PLUGIN_VERSION);
  assert.equal(first.project, 'repo');
  assert.equal(first.pluginRoot, PLUGIN_ROOT);
  assert.equal(first.n, 1);
  assert.equal(second.n, 2);
});

test('it never throws, even when the folder cannot be created', (t) => {
  const { dir, root } = tmpRepo(t);
  const blocker = path.join(dir, 'file');
  writeFileSync(blocker, '');
  withPluginData(path.join(blocker, 'data'), () => assert.doesNotThrow(() => logEvent(root, 'probe')));
});

test('the hooks and scripts log their events; the instructions log does not', (t) => {
  const { dir, root } = tmpRepo(t, { 'package.json': '{}', 'CLAUDE.md': '# x\n', 'src/a.ts': '1\n' });
  const data = path.join(dir, 'data');
  mkdirSync(data);
  const env = { CLAUDE_PLUGIN_DATA: data };
  mkdirSync(path.join(root, '.claude'));
  // Untracked, so the baseline has one dirty file to record.
  writeFileSync(path.join(root, '.claude/honest-docs.json'), JSON.stringify({ instructionsLog: true, guard: { command: ['true'] } }));

  runHook('session-baseline', { session_id: 's', source: 'startup' }, { root, env });
  writeFileSync(path.join(root, 'src/a.ts'), '2\n');
  runHook('stop-gate', { session_id: 's', permission_mode: 'default' }, { root, env });
  runHook('instructions-log', { session_id: 's', hook_event_name: 'InstructionsLoaded', file_path: path.join(root, 'CLAUDE.md'), load_reason: 'session_start' }, { root, env });
  runBin('honest-docs-grep', ['x'], { cwd: root, env });
  runBin('honest-docs-check', [], { cwd: root, env });

  const logged = events(data);
  assert.deepEqual(logged.map((e) => e.event), ['baseline', 'gate', 'docs-grep', 'docs-check']);
  for (const e of logged) assert.deepEqual(Object.keys(e).slice(0, 5), HEADER_FIELDS);
  assert.deepEqual(
    { ...logged[0], ts: undefined },
    { ...logged[0], ts: undefined, written: true, source: 'startup', dirty: 1 }
  );
  assert.equal(logged[1].outcome, 'pass');
  assert.equal(logged[1].kind, 'ran');
  assert.equal(logged[1].changed, 2);
  assert.equal(logged[1].checked, 1);
  assert.equal(logged[2].symbols, 1);
  assert.equal(typeof logged[3].problems, 'number');
  // Metadata only: no file content or path from the tree in any record.
  assert.doesNotMatch(JSON.stringify(logged), /src\/a\.ts|CLAUDE\.md/);
});

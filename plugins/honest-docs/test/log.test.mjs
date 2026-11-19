// The shared event log (core/log.mjs): <logDir>/events.jsonl in the project, written only by a process
// a hook started (HONEST_DOCS_HOOK=1), one JSON line per event carrying the fields its header lists,
// metadata only.
import assert from 'node:assert/strict';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { logEvent } from '../core/log.mjs';
import { PLUGIN_ROOT, PLUGIN_VERSION, agentSession, docsBaseline, eventLog, git, readLines, runScript, runHook, tmpRepo, writeCopy, writeDocsRule, writeFiles } from './helpers.mjs';

const HEADER_FIELDS = ['ts', 'event', 'pluginVersion', 'project', 'pluginRoot'];

/** logEvent in this process with HONEST_DOCS_HOOK set to `value` (or unset), restored afterwards. */
function asHook(value, fn) {
  const saved = process.env.HONEST_DOCS_HOOK;
  if (value === undefined) delete process.env.HONEST_DOCS_HOOK;
  else process.env.HONEST_DOCS_HOOK = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.HONEST_DOCS_HOOK;
    else process.env.HONEST_DOCS_HOOK = saved;
  }
}

test('outside a hook nothing is written', (t) => {
  const { dir, root } = tmpRepo(t);
  asHook(undefined, () => logEvent(root, 'probe', { n: 1 }));
  assert.deepEqual(readdirSync(dir), ['repo']);
  assert.deepEqual(readdirSync(root).sort(), ['.git', '.gitkeep']);
});

test('docs-check and docs-grep run from a terminal write no event log', (t) => {
  const { dir, root } = tmpRepo(t, { 'package.json': '{}', 'CLAUDE.md': '# x\n' });
  writeCopy(root);
  runScript('docs-check', [], { cwd: root });
  runScript('docs-grep', ['x'], { cwd: root });
  assert.deepEqual(readdirSync(dir), ['repo']);
  assert.deepEqual(readdirSync(root).sort(), ['.claude', '.git', '.gitkeep', 'CLAUDE.md', 'package.json']);
});

test('from a hook: one line in <logDir>/events.jsonl, the header fields first, then the metadata', (t) => {
  const { root } = tmpRepo(t);
  asHook('1', () => {
    logEvent(root, 'probe', { n: 1, outcome: 'pass' });
    logEvent(root, 'probe', { n: 2 });
  });

  const [first, second] = eventLog(root);
  assert.deepEqual(Object.keys(first), [...HEADER_FIELDS, 'n', 'outcome']);
  assert.match(first.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(first.event, 'probe');
  // Run from the plugin, the version is plugin.json's.
  assert.equal(first.pluginVersion, PLUGIN_VERSION);
  assert.equal(first.project, 'repo');
  assert.equal(first.pluginRoot, PLUGIN_ROOT);
  assert.equal(first.n, 1);
  assert.equal(second.n, 2);
});

test('the config moves it with logDir', (t) => {
  const { root } = tmpRepo(t, { '.claude/honest-docs.json': JSON.stringify({ logDir: 'tmp/logs/' }) });
  asHook('1', () => logEvent(root, 'probe'));
  assert.deepEqual(
    readLines(path.join(root, 'tmp/logs/events.jsonl')).map((line) => JSON.parse(line).event),
    ['probe']
  );
  assert.deepEqual(eventLog(root), []);
});

test('it never throws, even when the folder cannot be created', (t) => {
  const { root } = tmpRepo(t);
  writeFiles(root, { '.claude/honest-docs-state': '' });
  asHook('1', () => assert.doesNotThrow(() => logEvent(root, 'probe')));
});

test('the hooks and the docs-check they run log their events; the instructions log does not', (t) => {
  // Docs that pass docs-check, committed, so the gate gets as far as the guard and passes.
  const { root } = tmpRepo(t, { ...docsBaseline(), 'src/a.ts': '1\n' });
  writeDocsRule(root);
  writeFileSync(path.join(root, '.claude/honest-docs.json'), JSON.stringify({ instructionsLog: true, guard: { command: ['true'] } }));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'rule');

  const session = agentSession(root, 's');
  session.start();
  session.write('src/a.ts', '2\n', 'Edit');
  session.bash(() => writeFileSync(path.join(root, 'src/b.ts'), '1\n'));
  runHook('stop-gate', { session_id: 's', permission_mode: 'default' }, { root });
  runHook('instructions-log', { session_id: 's', hook_event_name: 'InstructionsLoaded', file_path: path.join(root, 'CLAUDE.md'), load_reason: 'session_start' }, { root });
  // Not hooks: these write nothing.
  runScript('docs-grep', ['x'], { cwd: root });
  runScript('docs-check', [], { cwd: root });

  // SessionStart and the gate each run docs-check, and those runs log too.
  const logged = eventLog(root);
  assert.deepEqual(logged.map((e) => e.event), ['docs-check', 'session-start', 'attribution', 'attribution', 'docs-check', 'gate']);
  for (const e of logged) assert.deepEqual(Object.keys(e).slice(0, 5), HEADER_FIELDS);
  assert.deepEqual(
    { ...logged[1], ts: undefined },
    { ...logged[1], ts: undefined, source: 'startup', written: true, problems: 0 }
  );
  assert.deepEqual([logged[2].tool, logged[2].paths, logged[3].tool, logged[3].paths], ['Edit', 1, 'Bash', 1]);
  assert.equal(logged[4].problems, 0);
  assert.equal(logged[5].outcome, 'pass');
  assert.equal(logged[5].kind, 'ran');
  assert.equal(logged[5].changed, 2);
  assert.equal(logged[5].checked, 2);
  // Metadata only: no file content or path from the tree in any record.
  assert.doesNotMatch(JSON.stringify(logged), /src\/[ab]\.ts|CLAUDE\.md/);
});

test('with a broken config the session start and the tool hooks say nothing and log config-error in the default logDir', (t) => {
  const { root } = tmpRepo(t, { '.claude/honest-docs.json': '{ not json', 'src/a.ts': '1\n' });

  const session = agentSession(root, 's');
  const runs = [session.start(), session.write('src/a.ts', '2\n', 'Edit'), session.bash()];
  for (const run of runs) assert.deepEqual([run.status, run.stdout, run.stderr], [0, '', '']);
  assert.deepEqual(eventLog(root).map((e) => [e.event, e.reason]), [
    ['session-start', 'config-error'],
    ['attribution', 'config-error'],
    ['attribution', 'config-error'],
    ['attribution', 'config-error'],
  ]);
});

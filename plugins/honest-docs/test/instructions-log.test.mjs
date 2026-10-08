// The instructions log (hooks/instructions-log.mjs): off by default; when on, one line per event in
// the format references/instructions-log.md gives.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readLines, runHook, tmpRepo } from './helpers.mjs';

const SESSION = 'abcdef12-3456-7890';
const LOG = 'artifacts/logs/instructions-abcdef12.log';
const TS = '\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z';

function project(t, config) {
  const { root } = tmpRepo(t, config ? { '.claude/honest-docs.json': JSON.stringify(config) } : {});
  const send = (payload) => runHook('instructions-log', { session_id: SESSION, ...payload }, { root });
  const lines = () => (existsSync(path.join(root, LOG)) ? readLines(path.join(root, LOG)) : []);
  return { root, send, lines };
}

const events = (root) => [
  {
    hook_event_name: 'InstructionsLoaded',
    file_path: path.join(root, '.claude/rules/code-quality.md'),
    load_reason: 'path_glob_match',
    trigger_file_path: path.join(root, 'lib/utils/cn.ts'),
  },
  { hook_event_name: 'InstructionsLoaded', file_path: path.join(root, 'CLAUDE.md'), load_reason: 'session_start' },
  { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'lib/utils/cn.ts') } },
  { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'src/new.ts' } },
  { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'probe-skill' } },
  { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'docs-audit', command_source: 'plugin' },
  { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, '.claude/skills/probe/SKILL.md') } },
];

test('off by default: writes nothing', (t) => {
  const p = project(t);
  for (const payload of events(p.root)) assert.equal(p.send(payload).status, 0);
  assert.equal(existsSync(path.join(p.root, 'artifacts')), false);
});

test('off when instructionsLog is anything but true', (t) => {
  const p = project(t, { instructionsLog: 'yes' });
  p.send(events(p.root)[0]);
  assert.equal(existsSync(path.join(p.root, 'artifacts')), false);
});

test('on: load, write: and skill: lines in the order they happened', (t) => {
  const p = project(t, { instructionsLog: true });
  for (const payload of events(p.root)) {
    const run = p.send(payload);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
  }
  const expected = [
    'path_glob_match  .claude/rules/code-quality.md trigger=lib/utils/cn.ts',
    'session_start  CLAUDE.md',
    'write:Edit  lib/utils/cn.ts',
    'write:Write  src/new.ts',
    'skill:Skill  probe-skill',
    'skill:slash  docs-audit source=plugin',
    'skill:Read  .claude/skills/probe/SKILL.md',
  ];
  const lines = p.lines();
  assert.equal(lines.length, expected.length);
  lines.forEach((line, i) => assert.match(line, new RegExp(`^${TS}  ${expected[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)));
});

test('on: what the log leaves out', (t) => {
  const p = project(t, { instructionsLog: true });
  const tool = (tool_name, file_path) => p.send({ hook_event_name: 'PostToolUse', tool_name, tool_input: { file_path } });
  tool('Read', path.join(p.root, 'src/a.ts')); // a Read outside .claude/skills/
  tool('Read', '/elsewhere/plugin/skills/docs-audit/SKILL.md'); // a plugin skill, outside the project
  tool('Write', '/elsewhere/file.ts'); // outside the repo
  tool('Write', path.join(p.root, 'artifacts/notes.md')); // under the top folder of stateDir/logDir
  tool('Edit', path.join(p.root, 'node_modules/x/index.js'));
  p.send({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: {} });
  p.send({ hook_event_name: 'UserPromptExpansion', expansion_type: 'other', command_name: 'x' });
  p.send({ hook_event_name: 'InstructionsLoaded' });
  assert.deepEqual(p.lines(), []);
});

test('a broken config: silent exit 0, nothing written, config-error in the event log', (t) => {
  const { dir, root } = tmpRepo(t, { '.claude/honest-docs.json': '{ not json' });
  const data = path.join(dir, 'data');
  const run = runHook('instructions-log', { session_id: SESSION, ...events(root)[0] }, { root, env: { CLAUDE_PLUGIN_DATA: data } });
  assert.deepEqual([run.status, run.stdout, run.stderr], [0, '', '']);
  assert.equal(existsSync(path.join(root, 'artifacts')), false);
  const logged = readLines(path.join(data, 'events.jsonl')).map((line) => JSON.parse(line));
  assert.deepEqual(logged.map((e) => [e.event, e.reason]), [['instructions-log', 'config-error']]);
});

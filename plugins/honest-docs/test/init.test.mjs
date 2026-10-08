// honest-docs-init (scripts/init.mjs → core/init.mjs): the first run, a second run, a fragment
// rewrapped by hand and a fragment whose words changed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../core/config.mjs';
import { renderDocsRule } from '../core/init.mjs';
import { PLUGIN_VERSION, fragment, runBin, tmpRepo, writeDocsRule } from './helpers.mjs';

const HEAD = '# Project\n\n## CRITICAL\n\n- Keep it short.\n- ';
const MIDDLE = '\n\n## Docs\n\n';
const TAIL = '\n\nProject line after the policy.\n';

/** A CLAUDE.md as a project has it before its first /init: the pre-0.1.0 docs policy. */
const claudeMd = (readLine, policy) => `${HEAD}${readLine}${MIDDLE}${policy}${TAIL}`;
const before = () => claudeMd(fragment('read-line'), fragment('docs-policy', 'pre-0.1.0'));
const after = () => claudeMd(fragment('read-line'), fragment('docs-policy'));

const init = (root) => runBin('honest-docs-init', [], { cwd: root });
const read = (root, file) => readFileSync(path.join(root, file), 'utf8');
const CHECK_NOTE = 'honest-docs-init: honest-docs-check must report no problems: the Stop gate runs it over all docs on every change.';
const NO_GUARD = 'honest-docs-init: .claude/honest-docs.json sets no guard.command: the Stop gate runs honest-docs-check alone.';

test('first run: writes the rule, the config skeleton and the current fragments', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': before() });
  const run = init(root);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout,
    [
      'honest-docs-init: wrote .claude/rules/docs.md',
      'honest-docs-init: created .claude/honest-docs.json',
      'honest-docs-init: wrote CLAUDE.md',
      CHECK_NOTE,
      NO_GUARD,
      `honest-docs-init: docs-policy: pre-0.1.0 → ${PLUGIN_VERSION}`,
      '',
    ].join('\n')
  );
  assert.equal(read(root, 'CLAUDE.md'), after());
  assert.deepEqual(JSON.parse(read(root, '.claude/honest-docs.json')), { docsDir: '_docs', guard: { command: null } });

  const rule = read(root, '.claude/rules/docs.md');
  assert.equal(rule, renderDocsRule(loadConfig(root)));
  assert.match(rule, /^---\npaths:\n {2}- '_docs\/\*\*\/\*\.md'\n---\n/);
  assert.equal(rule.trimEnd().split('\n').at(-1), `Written by /honest-docs:init ${PLUGIN_VERSION} — fixes go to the plugin, not this file.`);
  assert.doesNotMatch(rule, /\{\{/);
});

test('the rule takes docsDir and index.file from the config', (t) => {
  const { root } = tmpRepo(t, {
    'AGENTS.md': after(),
    '.claude/honest-docs.json': JSON.stringify({ docsDir: 'docs/', index: { file: 'AGENTS.md' }, guard: { command: ['true'] } }),
  });
  const run = init(root);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `honest-docs-init: wrote .claude/rules/docs.md\n${CHECK_NOTE}\n`);
  const rule = read(root, '.claude/rules/docs.md');
  assert.match(rule, /- 'docs\/\*\*\/\*\.md'/);
  assert.match(rule, /a line in the AGENTS\.md docs index/);
});

test('second run: no changes, nothing rewritten', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': before() });
  init(root);
  const files = ['CLAUDE.md', '.claude/rules/docs.md', '.claude/honest-docs.json'];
  const first = files.map((file) => read(root, file));

  const run = init(root);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, `honest-docs-init: no changes\n${CHECK_NOTE}\n${NO_GUARD}\n`);
  assert.deepEqual(files.map((file) => read(root, file)), first);
});

test('a config the project already has is left alone', (t) => {
  const config = '{ "docsDir": "_docs", "guard": { "command": ["bash", "guard.sh"] } }\n';
  const { root } = tmpRepo(t, { 'CLAUDE.md': after(), '.claude/honest-docs.json': config });
  const run = init(root);
  assert.equal(run.stdout, `honest-docs-init: wrote .claude/rules/docs.md\n${CHECK_NOTE}\n`);
  assert.equal(read(root, '.claude/honest-docs.json'), config);
});

test('an outdated docs.md is overwritten', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': after(), '.claude/rules/docs.md': 'Edited by hand.\n' });
  init(root);
  assert.equal(read(root, '.claude/rules/docs.md'), renderDocsRule(loadConfig(root)));
});

test('a fragment wrapped differently is recognised and replaced, the rest of the file untouched', (t) => {
  const rewrapped = fragment('docs-policy', 'pre-0.1.0').split(/\s+/).join(' ').replace(/(.{60,}?) /g, '$1\n');
  assert.notEqual(rewrapped, fragment('docs-policy', 'pre-0.1.0'));
  const { root } = tmpRepo(t, { 'CLAUDE.md': claudeMd(fragment('read-line'), rewrapped) });

  const run = init(root);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /docs-policy: pre-0\.1\.0 → /);
  assert.equal(read(root, 'CLAUDE.md'), after());
});

test('after the first run, a fragment with a changed word: exit 1, nothing written', (t) => {
  const changed = fragment('docs-policy', 'pre-0.1.0').replace('A lying doc', 'A wrong doc');
  const text = claudeMd(fragment('read-line'), changed);
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  writeDocsRule(root); // stamped: an earlier run happened

  const run = init(root);
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(
    run.stderr,
    'honest-docs-init: docs-policy: no version of the fragment found in CLAUDE.md, though /honest-docs:init has run here — ' +
      'its words were changed; known versions are in templates/fragments/docs-policy/\n' +
      'honest-docs-init: nothing written\n'
  );
  assert.equal(read(root, 'CLAUDE.md'), text);
  assert.equal(existsSync(path.join(root, '.claude/honest-docs.json')), false);
});

test('a fragment found twice: exit 1, nothing written', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': `${after()}\n${fragment('read-line')}\n` });
  const run = init(root);
  assert.equal(run.status, 1);
  assert.ok(
    run.stderr.startsWith(`honest-docs-init: read-line: found 2 times in CLAUDE.md (${PLUGIN_VERSION}, ${PLUGIN_VERSION})\n`),
    run.stderr
  );
  assert.equal(existsSync(path.join(root, '.claude')), false);
});

test('no CLAUDE.md: exit 1, nothing written', (t) => {
  const { root } = tmpRepo(t);
  const run = init(root);
  assert.equal(run.status, 1);
  assert.equal(run.stderr, 'honest-docs-init: CLAUDE.md not found\nhonest-docs-init: nothing written\n');
  assert.equal(existsSync(path.join(root, '.claude')), false);
});

test('init leaves a tree that docs-check passes on the init category', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': `${before()}\n## Rules\n\n- [docs](.claude/rules/docs.md)\n`, 'package.json': '{}' });
  init(root);
  const run = runBin('honest-docs-check', [], { cwd: root });
  assert.doesNotMatch(run.stderr, /^ {2}init \(/m);
  // Writing the file by hand afterwards with another stamp is what docs-check flags.
  writeFileSync(path.join(root, '.claude/rules/docs.md'), read(root, '.claude/rules/docs.md').replace(PLUGIN_VERSION, '0.0.1'));
  assert.match(runBin('honest-docs-check', [], { cwd: root }).stderr, /^ {2}init \(1\)$/m);
});

const PLAIN = '# Project\n\n## Rules\n\n- [docs](.claude/rules/docs.md)\n\nProject text.\n';
const APPENDED = (names) =>
  `honest-docs-init: appended ${names} to CLAUDE.md under "## honest-docs"; move them anywhere in the file, init finds them by their words`;

test('first run without the fragments: both appended under one heading, the rest byte for byte', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': PLAIN, 'package.json': '{}' });
  const run = init(root);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout,
    [
      'honest-docs-init: wrote .claude/rules/docs.md',
      'honest-docs-init: created .claude/honest-docs.json',
      'honest-docs-init: wrote CLAUDE.md',
      CHECK_NOTE,
      NO_GUARD,
      APPENDED('read-line and docs-policy'),
      '',
    ].join('\n')
  );
  assert.equal(
    read(root, 'CLAUDE.md'),
    `${PLAIN}\n## honest-docs\n\n${fragment('read-line')}\n\n${fragment('docs-policy')}\n`
  );
  assert.doesNotMatch(runBin('honest-docs-check', [], { cwd: root }).stderr, /^ {2}init \(/m);

  // Second run: everything is found where it was appended.
  assert.equal(init(root).stdout, `honest-docs-init: no changes\n${CHECK_NOTE}\n${NO_GUARD}\n`);
});

test('fragments moved by hand elsewhere in the file: still no changes', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': PLAIN });
  init(root);
  const moved = `# Project\n\n${fragment('docs-policy')}\n\n## Rules\n\n${fragment('read-line')}\n\n- [docs](.claude/rules/docs.md)\n\nProject text.\n`;
  writeFileSync(path.join(root, 'CLAUDE.md'), moved);

  const run = init(root);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `honest-docs-init: no changes\n${CHECK_NOTE}\n${NO_GUARD}\n`);
  assert.equal(read(root, 'CLAUDE.md'), moved);
});

test('first run with one fragment already there: only the missing one is appended', (t) => {
  const text = `# Project\n\n${fragment('read-line')}\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  const run = init(root);

  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.endsWith(`${APPENDED('docs-policy')}\n`), run.stdout);
  assert.equal(read(root, 'CLAUDE.md'), `${text}\n## honest-docs\n\n${fragment('docs-policy')}\n`);
});

test('a broken config: exit 2 with one line naming the file, nothing written', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': before(), '.claude/honest-docs.json': '{ not json' });
  const run = init(root);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^honest-docs-init: \.claude\/honest-docs\.json: not valid JSON \(.+\)\n$/);
  assert.equal(read(root, 'CLAUDE.md'), before());
  assert.equal(existsSync(path.join(root, '.claude/rules/docs.md')), false);
});

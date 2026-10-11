// honest-docs-init (scripts/init.mjs → core/init.mjs): the first run, a second run, a fragment
// rewrapped by hand and a fragment whose words changed.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../core/config.mjs';
import { fragmentVersions, renderDocsRule } from '../core/init.mjs';
import { PLUGIN_VERSION, fragment, fragmentVersion, runBin, tmpRepo, writeDocsRule, writeFiles } from './helpers.mjs';

const HEAD = '# Project\n\n## CRITICAL\n\n- Keep it short.\n- ';
const MIDDLE = '\n\n## Docs\n\n';
// The Rules section already lists the rule: init's line for it is the new path, tested on its own.
const TAIL = '\n\nProject line after the policy.\n\n## Rules\n\n- [docs](.claude/rules/docs.md)\n';

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
      `honest-docs-init: docs-policy: pre-0.1.0 → ${fragmentVersion('docs-policy')}`,
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
    run.stderr.startsWith(`honest-docs-init: read-line: found 2 times in CLAUDE.md (${fragmentVersion('read-line')}, ${fragmentVersion('read-line')})\n`),
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
  // Changing its text by hand afterwards is what docs-check flags.
  writeFileSync(path.join(root, '.claude/rules/docs.md'), read(root, '.claude/rules/docs.md').replace('One fact, one home', 'One fact'));
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
  const text = `# Project\n\n${fragment('read-line')}\n\n## Rules\n\n- [docs](.claude/rules/docs.md)\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  const run = init(root);

  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.endsWith(`${APPENDED('docs-policy')}\n`), run.stdout);
  assert.equal(read(root, 'CLAUDE.md'), `${text}\n## honest-docs\n\n${fragment('docs-policy')}\n`);
});

// P1: the docs rule gets a line in the Rules index.

const RULE_LINE = "- [`docs.md`](.claude/rules/docs.md) — `_docs/`: what to write and what not to.";
const LISTED = 'honest-docs-init: listed .claude/rules/docs.md in the "## Rules" section of CLAUDE.md';
const fragments = () => `${fragment('read-line')}\n\n${fragment('docs-policy')}`;

test('Rules section without the rule: the line goes at its end, and a second run adds nothing', (t) => {
  const text = `# Project\n\n${fragments()}\n\n## Rules (\`.claude/rules/\`)\n\nIntro.\n\n- [x](.claude/rules/x.md)\n\n## Next\n\nText.\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text, '.claude/rules/x.md': 'x\n', 'package.json': '{}' });
  const run = init(root);

  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(`${LISTED}\n`), run.stdout);
  assert.equal(read(root, 'CLAUDE.md'), text.replace('- [x](.claude/rules/x.md)\n', `- [x](.claude/rules/x.md)\n${RULE_LINE}\n`));
  assert.doesNotMatch(runBin('honest-docs-check', [], { cwd: root }).stderr, /^ {2}index \(/m);

  const second = init(root);
  assert.equal(second.stdout, `honest-docs-init: no changes\n${CHECK_NOTE}\n${NO_GUARD}\n`);
});

test('Rules section ending in prose: the line is set off by a blank line', (t) => {
  const text = `# Project\n\n${fragments()}\n\n## Rules\n\nNone yet.\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  init(root);
  assert.equal(read(root, 'CLAUDE.md'), `${text.trimEnd()}\n\n${RULE_LINE}\n`);
});

test('no Rules section, first run: created right after the appended ## honest-docs', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': '# Project\n\nText.\n', 'package.json': '{}' });
  const run = init(root);

  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.endsWith(`${APPENDED('read-line and docs-policy')}\n${LISTED}\n`), run.stdout);
  assert.equal(read(root, 'CLAUDE.md'), `# Project\n\nText.\n\n## honest-docs\n\n${fragments()}\n\n## Rules\n\n${RULE_LINE}\n`);
  assert.doesNotMatch(runBin('honest-docs-check', [], { cwd: root }).stderr, /^ {2}(index|init) \(/m);
  assert.equal(init(root).stdout, `honest-docs-init: no changes\n${CHECK_NOTE}\n${NO_GUARD}\n`);
});

test('no Rules section, ## honest-docs followed by another section: created between them', (t) => {
  const text = `# Project\n\n## honest-docs\n\n${fragments()}\n\n## Later\n\nText.\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  init(root);
  assert.equal(read(root, 'CLAUDE.md'), text.replace('## Later', `## Rules\n\n${RULE_LINE}\n\n## Later`));
});

test('no Rules section and no ## honest-docs: created at the end of the file', (t) => {
  const text = `# Project\n\n${fragments()}\n\nLast line.`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  init(root);
  assert.equal(read(root, 'CLAUDE.md'), `${text}\n\n## Rules\n\n${RULE_LINE}\n`);
});

test('the Rules line takes docsDir and rulesHeading from the config', (t) => {
  const text = `# Project\n\n${fragments()}\n\n## Instructions\n\n- [x](.claude/rules/x.md)\n`;
  const { root } = tmpRepo(t, {
    'CLAUDE.md': text,
    'docs/a.md': '# A\n',
    '.claude/honest-docs.json': JSON.stringify({ docsDir: 'docs', index: { rulesHeading: 'Instructions' } }),
  });
  const run = init(root);
  assert.match(run.stdout, /listed \.claude\/rules\/docs\.md in the "## Instructions" section of CLAUDE\.md/);
  assert.equal(read(root, 'CLAUDE.md'), `${text}${RULE_LINE.replace('_docs/', 'docs/')}\n`);
});

test('a rule listed under any other form of link counts as listed: old path, untouched', (t) => {
  const text = `# Project\n\n${fragments()}\n\n## Rules\n\n- See .claude/rules/docs.md for docs.\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  const run = init(root);
  assert.doesNotMatch(run.stdout, /listed/);
  assert.equal(read(root, 'CLAUDE.md'), text);
});

test('init fails on a fragment: the Rules line is not written either', (t) => {
  const text = `# Project\n\n${fragments()}\n\n${fragment('read-line')}\n`;
  const { root } = tmpRepo(t, { 'CLAUDE.md': text });
  assert.equal(init(root).status, 1);
  assert.equal(read(root, 'CLAUDE.md'), text);
});

// P2: a docsDir that does not exist.

const missingDocsDir = (folders) =>
  `honest-docs-init: warning: docsDir "_docs" does not exist, so honest-docs-check scans no docs there; ${folders} ` +
  'Set docsDir in .claude/honest-docs.json, then run /honest-docs:init again.\n';

test('docsDir missing: a warning naming the folders that hold .md files, exit 0', (t) => {
  const { root } = tmpRepo(t, {
    'CLAUDE.md': after(),
    'README.md': '# Root files are not a folder\n',
    'docs/index.md': '',
    'docs/features/a.md': '',
    'docs/features/b.md': '',
    'docs/features/notes.txt': '',
    'node_modules/pkg/README.md': '',
    'packages/app/node_modules/dep/README.md': '',
  });
  const run = init(root);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, missingDocsDir('folders holding .md files: docs/features/ (2), docs/ (1).'));
  assert.ok(existsSync(path.join(root, '.claude/rules/docs.md')), 'init still writes');
});

test('docsDir missing and no .md folder anywhere', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': after() });
  assert.equal(init(root).stderr, missingDocsDir('no folder holds .md files.'));
});

test('docsDir missing: at most 10 folders named', (t) => {
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${String(i).padStart(2, '0')}/a.md`, '']));
  const { root } = tmpRepo(t, { 'CLAUDE.md': after(), ...files });
  const named = Array.from({ length: 10 }, (_, i) => `d${String(i).padStart(2, '0')}/ (1)`).join(', ');
  assert.equal(init(root).stderr, missingDocsDir(`folders holding .md files: ${named}, and 2 more.`));
});

test('docsDir there: no warning (old path)', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': after(), '_docs/a.md': '' });
  const run = init(root);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
});

// P3: files init maintains that git ignores.

test('a file init writes is gitignored: one warning per file, exit 0, still written', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': after(), '_docs/a.md': '', '.gitignore': '# local\n.claude/\n' });
  const run = init(root);
  assert.equal(run.status, 0);
  assert.equal(
    run.stderr,
    'honest-docs-init: warning: .claude/rules/docs.md is ignored by git (.gitignore:2:.claude/), so it will not be committed and nobody else gets it.\n' +
      'honest-docs-init: warning: .claude/honest-docs.json is ignored by git (.gitignore:2:.claude/), so it will not be committed and nobody else gets it.\n'
  );
  assert.ok(existsSync(path.join(root, '.claude/rules/docs.md')));
  // A second run writes nothing and still warns: the files are still not committed.
  assert.match(init(root).stderr, /docs\.md is ignored by git/);
});

test('a tracked file matching an ignore pattern, or one a negation re-includes, is not reported', (t) => {
  const { root } = tmpRepo(t, { 'CLAUDE.md': after(), '_docs/a.md': '' });
  // Written after the commit, so CLAUDE.md is tracked though the pattern matches it.
  writeFiles(root, { '.gitignore': 'CLAUDE.md\n.claude/*\n!.claude/rules/\n!.claude/honest-docs.json\n' });
  const run = init(root);
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
});

test('outside a git repo: no ignore check, no warning', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'honest-docs-nogit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, { 'CLAUDE.md': after(), '_docs/a.md': '', '.gitignore': '.claude/\n' });
  const run = init(dir);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.ok(existsSync(path.join(dir, '.claude/rules/docs.md')));
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

/** A fragment folder holding `versions`, each file's text its own version name. */
function fragmentDir(t, versions) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'honest-docs-fragments-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, Object.fromEntries(versions.map((v) => [`${v}.md`, v])));
  return dir;
}

const versionsOf = (versions) => versions.map((v) => v.version);

test('fragment versions: the current one is the newest not above the plugin version', (t) => {
  const dir = fragmentDir(t, ['pre-0.1.0', '0.1.0']);
  assert.deepEqual(versionsOf(fragmentVersions('x', '0.1.1', dir)), ['0.1.0', 'pre-0.1.0']);
  // The plugin's own templates: 0.1.1 changed no fragment, so 0.1.0 is current.
  assert.equal(fragmentVersions('docs-policy', '0.1.1')[0].version, '0.1.0');
});

test('fragment versions: compared as numbers, not text', (t) => {
  const dir = fragmentDir(t, ['0.1.9', '0.1.10', '0.2.0']);
  assert.deepEqual(versionsOf(fragmentVersions('x', '0.1.10', dir)), ['0.1.10', '0.1.9']);
});

test('fragment versions: one above the plugin version is ignored, not even recognised', (t) => {
  const dir = fragmentDir(t, ['0.1.0', '0.2.0']);
  assert.deepEqual(versionsOf(fragmentVersions('x', '0.1.1', dir)), ['0.1.0']);
});

test('fragment versions: pre-<v> is never current, and with nothing else it is an error', (t) => {
  const dir = fragmentDir(t, ['pre-0.1.0', '0.2.0']);
  assert.throws(() => fragmentVersions('x', '0.1.1', dir), /templates\/fragments\/x\/ has no version at or below 0\.1\.1/);
});

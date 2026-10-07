// honest-docs-check (scripts/docs-check.mjs): a clean tree passes, and each of the eight categories
// fails on its own when one thing in an otherwise clean tree is broken.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../core/config.mjs';
import { renderDocsRule } from '../core/init.mjs';
import { PLUGIN_VERSION, fragment, runBin, tmpRepo, writeFiles } from './helpers.mjs';

const CHECKS = ['links', 'anchors', 'paths', 'scripts', 'index', 'covers', 'updated', 'init'];

const ALPHA = `---
covers:
  - 'src/**'
---

# Alpha

**Last Updated:** 2026-01-01 10:00 CET

See [Beta](../tools/beta.md#details), \`src/alpha.ts\` and \`npm run test\`.
`;

const BETA = `# Beta

**Last Updated:** 2026-01-01 10:00 CET

## Details

Text.
`;

const claudeMd = () => `# Fixture

${fragment('read-line')}

## Docs

${fragment('docs-policy')}

- [Alpha](_docs/features/alpha.md)
- [Beta](_docs/tools/beta.md)

## Rules

- [docs](.claude/rules/docs.md)
`;

/** A project every check passes on: 2 docs in _docs/, the rule /init writes, CLAUDE.md. */
function cleanProject(t) {
  const project = tmpRepo(t, {
    'package.json': `${JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } })}\n`,
    'CLAUDE.md': claudeMd(),
    '_docs/features/alpha.md': ALPHA,
    '_docs/tools/beta.md': BETA,
    'src/alpha.ts': 'export const alpha = 1;\n',
  });
  writeFiles(project.root, { '.claude/rules/docs.md': renderDocsRule(loadConfig(project.root)) });
  return project;
}

const check = (root) => runBin('honest-docs-check', [], { cwd: root });

const edit = (root, file, change) => writeFileSync(path.join(root, file), change(readFileSync(path.join(root, file), 'utf8')));

/** Exit 1 with exactly one problem, in `category` alone, reported as `line`. */
function assertOnly(run, category, line) {
  assert.equal(run.status, 1, run.stderr);
  for (const other of CHECKS.filter((c) => c !== category)) assert.doesNotMatch(run.stderr, new RegExp(`^  ${other} \\(`, 'm'));
  assert.match(run.stderr, new RegExp(`^  ${category} \\(1\\)$`, 'm'));
  assert.ok(run.stderr.includes(`\n    ${line}\n`), `expected line "${line}" in:\n${run.stderr}`);
  assert.match(run.stderr, /^docs-check: 1 problem\(s\) in \d+ files$/m);
}

test('a clean project passes', (t) => {
  const { root } = cleanProject(t);
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
  // _docs/ (2) + .claude/rules/docs.md + CLAUDE.md; README.md is absent.
  assert.equal(run.stdout, 'docs-check: 4 files, no problems\n');
  assert.equal(run.stderr, '');
});

test('it runs from a subfolder of the project', (t) => {
  const { root } = cleanProject(t);
  const run = runBin('honest-docs-check', [], { cwd: path.join(root, 'src') });
  assert.equal(run.status, 0, run.stderr);
});

test('links: a link to a file that does not exist', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => `${text}\nSee [gone](../gone.md).\n`);
  assertOnly(check(root), 'links', '_docs/features/alpha.md:12  no such file: ../gone.md');
});

test('links: a missing path listed in absentByDesign is accepted', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { '.claude/honest-docs.json': JSON.stringify({ absentByDesign: ['gone.md'] }) });
  edit(root, '_docs/features/alpha.md', (text) => `${text}\nSee [gone](../../gone.md).\n`);
  assert.equal(check(root).status, 0);
});

test('anchors: a link to a heading that does not exist', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text.replace('#details', '#nope'));
  assertOnly(check(root), 'anchors', '_docs/features/alpha.md:10  no heading "#nope" in ../tools/beta.md');
});

test('paths: a backticked repo path that does not exist', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text.replace('src/alpha.ts', 'src/gone.ts'));
  assertOnly(check(root), 'paths', '_docs/features/alpha.md:10  no such path: src/gone.ts');
});

test('scripts: an npm run name package.json does not have', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text.replace('npm run test', 'npm run nope'));
  assertOnly(check(root), 'scripts', '_docs/features/alpha.md:10  no npm script: nope');
});

test('index: a page in _docs/features/ the index does not list', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { '_docs/features/gamma.md': BETA.replace('Beta', 'Gamma') });
  assertOnly(check(root), 'index', 'CLAUDE.md  page missing from the docs index: _docs/features/gamma.md');
});

test('index: the index lists a page that is gone', (t) => {
  const { root } = cleanProject(t);
  edit(root, 'CLAUDE.md', (text) => text.replace('- [Beta]', '- [Gamma](_docs/tools/gamma.md)\n- [Beta]'));
  const run = check(root);
  // The same line is a broken link too, so this one case reports two categories.
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('\n    CLAUDE.md  docs index lists a page that is gone: _docs/tools/gamma.md\n'));
  assert.ok(run.stderr.includes('\n    CLAUDE.md:14  no such file: _docs/tools/gamma.md\n'));
  assert.match(run.stderr, /^docs-check: 2 problem\(s\) in 4 files$/m);
});

test('index: a rule the Rules section does not list', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { '.claude/rules/extra.md': '# Extra\n' });
  assertOnly(check(root), 'index', 'CLAUDE.md  rule missing from the Rules index: .claude/rules/extra.md');
});

test('covers: a glob that matches no file', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text.replace("'src/**'", "'lib/**'"));
  assertOnly(check(root), 'covers', '_docs/features/alpha.md  covers matches no file: lib/**');
});

test('covers: a key no glob can be read from', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text.replace("covers:\n  - 'src/**'", 'covers: []'));
  assertOnly(check(root), 'covers', '_docs/features/alpha.md  covers: declared, but no glob could be read from it');
});

test('updated: a doc in _docs/ without its Last Updated line', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/tools/beta.md', (text) => text.replace('**Last Updated:** 2026-01-01 10:00 CET\n\n', ''));
  assertOnly(
    check(root),
    'updated',
    '_docs/tools/beta.md  no **Last Updated:** line — add one under the H1, any date; the guard gate sets it'
  );
});

test('updated: a folder listed in undated is exempt', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, {
    '.claude/honest-docs.json': JSON.stringify({ undated: ['_docs/priv'] }),
    '_docs/priv/notes.md': '# Notes\n',
  });
  assert.equal(check(root).status, 0);
});

test('init: docs.md stamped by another plugin version', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => text.replace(`init ${PLUGIN_VERSION} —`, 'init 0.0.9 —'));
  assertOnly(
    check(root),
    'init',
    `.claude/rules/docs.md  written by 0.0.9, the plugin is ${PLUGIN_VERSION} — run /honest-docs:init`
  );
});

test('init: docs.md without a stamp', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => `${text}\nA line added by hand.\n`);
  assertOnly(check(root), 'init', '.claude/rules/docs.md  no /honest-docs:init stamp on the last line — run /honest-docs:init');
});

test('init: docs.md missing', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, '.claude/rules/docs.md'));
  const run = check(root);
  // The Rules section still links it, so links and index report it as well.
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('\n    .claude/rules/docs.md  missing — run /honest-docs:init\n'));
});

test('init: a CLAUDE.md fragment missing', (t) => {
  const { root } = cleanProject(t);
  edit(root, 'CLAUDE.md', (text) => text.replace(fragment('read-line'), 'Read files however you like.'));
  assertOnly(check(root), 'init', `CLAUDE.md  no ${PLUGIN_VERSION} read-line fragment — run /honest-docs:init`);
});

test('init: an older version of a fragment counts as missing', (t) => {
  const { root } = cleanProject(t);
  edit(root, 'CLAUDE.md', (text) => text.replace(fragment('docs-policy'), fragment('docs-policy', 'pre-0.1.0')));
  const run = check(root);
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes(`\n    CLAUDE.md  no ${PLUGIN_VERSION} docs-policy fragment — run /honest-docs:init\n`));
});

// Known limitation of 0.1.0 (CHANGELOG): docs-check needs package.json and CLAUDE.md and fails with
// an uncaught error without either. 0.1.x is planned to make it cope; these tests then change.
test('0.1.0 limitation: no package.json fails with an error', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, 'package.json'));
  const run = check(root);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /ENOENT.*package\.json/);
  assert.doesNotMatch(run.stderr, /^docs-check:/m);
});

test('0.1.0 limitation: no CLAUDE.md fails with an error', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, 'CLAUDE.md'));
  const run = check(root);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /ENOENT.*CLAUDE\.md/);
  assert.doesNotMatch(run.stderr, /^docs-check:/m);
});

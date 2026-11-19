// scripts/docs-check.mjs, run from the copy: a clean tree passes, and each of the eight categories
// fails on its own when one thing in an otherwise clean tree is broken.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../core/config.mjs';
import { renderDocsRule } from '../core/init.mjs';
import { PLUGIN_ROOT, PLUGIN_VERSION, cleanEnv, fragment, fragmentVersion, git, runScript, tmpRepo, writeFiles } from './helpers.mjs';

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

const check = (root) => runScript('docs-check', [], { cwd: root });

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
  const run = runScript('docs-check', [], { cwd: path.join(root, 'src') });
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

test('paths: an import specifier resolves with an extension or as a folder index', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, {
    'src/hooks/useThing.tsx': '',
    'src/lib/index.ts': '',
    'src/tool.mjs': '',
    'src/ui/index.jsx': '',
  });
  edit(root, '_docs/features/alpha.md', (text) => `${text}\n\`src/alpha\`, \`src/hooks/useThing\`, \`src/lib\`, \`src/tool\`, \`src/ui/\`.\n`);
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
});

test('paths: a specifier that resolves to nothing is still reported', (t) => {
  const { root } = cleanProject(t);
  // A .d.ts or a .json beside it is not one of the extensions tried.
  writeFiles(root, { 'src/types.d.ts': '', 'src/data.json': '{}' });
  edit(root, '_docs/features/alpha.md', (text) => `${text}\n\`src/types\`\n`);
  assertOnly(check(root), 'paths', '_docs/features/alpha.md:12  no such path: src/types');
});

for (const runner of ['pnpm', 'yarn', 'bun']) {
  test(`scripts: a ${runner} run name package.json does not have`, (t) => {
    const { root } = cleanProject(t);
    edit(root, '_docs/features/alpha.md', (text) => `${text}\n\`${runner} run nope\`\n`);
    assertOnly(check(root), 'scripts', '_docs/features/alpha.md:12  no npm script: nope');
  });

  test(`scripts: a ${runner} run name package.json has passes`, (t) => {
    const { root } = cleanProject(t);
    edit(root, '_docs/features/alpha.md', (text) => `${text}\n\`${runner} run test\`\n`);
    assert.equal(check(root).status, 0);
  });
}

test('scripts: bare yarn and pnpm are not checked, they may run a binary', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => `${text}\n\`yarn tsc\`, \`pnpm eslint\`, \`yarn nope\`.\n`);
  assert.equal(check(root).status, 0);
});

test('scripts: npm run inside a longer word is not a command', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => `${text}\nxnpm run nope\n`);
  assert.equal(check(root).status, 0);
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
  // The line moves with the docs-policy fragment above it.
  const line = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').split('\n').indexOf('- [Gamma](_docs/tools/gamma.md)') + 1;
  // The same line is a broken link too, so this one case reports two categories.
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('\n    CLAUDE.md  docs index lists a page that is gone: _docs/tools/gamma.md\n'));
  assert.ok(run.stderr.includes(`\n    CLAUDE.md:${line}  no such file: _docs/tools/gamma.md\n`));
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

/** The doc with every line ending turned into CRLF, as a Windows checkout with core.autocrlf writes it. */
const toCrlf = (root, file) => edit(root, file, (text) => text.replace(/\r?\n/g, '\r\n'));

for (const [what, glob] of [
  ['a glob that matches', 'src/**'],
  ['a glob that matches nothing', 'lib/**'],
]) {
  test(`covers: a CRLF doc gives the same findings as its LF copy, ${what}`, (t) => {
    const { root } = cleanProject(t);
    edit(root, '_docs/features/alpha.md', (text) => text.replace("'src/**'", `'${glob}'`));
    const lf = check(root);
    toCrlf(root, '_docs/features/alpha.md');
    assert.deepEqual(check(root), lf);
    if (glob === 'src/**') assert.equal(lf.status, 0, lf.stderr);
    else assertOnly(lf, 'covers', `_docs/features/alpha.md  covers matches no file: ${glob}`);
  });
}

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

test('init: docs.md stamped by another plugin version, with the current text, passes', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => text.replace(`init ${PLUGIN_VERSION} —`, 'init 0.0.9 —'));
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
});

test('init: docs.md rewrapped by a formatter, same words, passes', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => {
    const lines = text.trimEnd().split('\n');
    const body = lines.slice(0, -1).join('\n').replace(/one home\*\* — everywhere/, 'one home**\n—   everywhere');
    return `${body.replace(/\n(?=[a-z])/g, ' ')}\n${lines.at(-1)}\n`;
  });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
});

test('init: docs.md with a changed text and the current stamp', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => text.replace('One fact, one home', 'One fact, two homes'));
  assertOnly(check(root), 'init', '.claude/rules/docs.md  differs from the rule this plugin writes — run /honest-docs:update');
});

test('init: docs.md with a line added after the stamp', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => `${text}\nA line added by hand.\n`);
  assertOnly(check(root), 'init', '.claude/rules/docs.md  differs from the rule this plugin writes — run /honest-docs:update');
});

test('init: docs.md missing', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, '.claude/rules/docs.md'));
  const run = check(root);
  // The Rules section still links it, so links and index report it as well.
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('\n    .claude/rules/docs.md  missing — run /honest-docs:update\n'));
});

test('init: a CLAUDE.md fragment missing', (t) => {
  const { root } = cleanProject(t);
  edit(root, 'CLAUDE.md', (text) => text.replace(fragment('read-line'), 'Read files however you like.'));
  assertOnly(check(root), 'init', `CLAUDE.md  no ${fragmentVersion('read-line')} read-line fragment — run /honest-docs:update`);
});

// check() runs docs-check from the copy it puts in the project, so the tests above name update. Without
// a copy in the project, init is the fix: these run the plugin's own docs-check.
const checkWithoutCopy = (root) => {
  const run = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'docs-check.mjs')], { cwd: root, encoding: 'utf8', env: cleanEnv() });
  assert.equal(existsSync(path.join(root, '.claude/honest-docs')), false);
  return run;
};

test('init: docs.md changed, in a project without a copy, says to run init', (t) => {
  const { root } = cleanProject(t);
  edit(root, '.claude/rules/docs.md', (text) => text.replace('One fact, one home', 'One fact, two homes'));
  assertOnly(checkWithoutCopy(root), 'init', '.claude/rules/docs.md  differs from the rule this plugin writes — run /honest-docs:init');
});

test('init: a CLAUDE.md fragment missing, in a project without a copy, says to run init', (t) => {
  const { root } = cleanProject(t);
  edit(root, 'CLAUDE.md', (text) => text.replace(fragment('read-line'), 'Read files however you like.'));
  assertOnly(checkWithoutCopy(root), 'init', `CLAUDE.md  no ${fragmentVersion('read-line')} read-line fragment — run /honest-docs:init`);
});

test('init: an older version of a fragment counts as missing', (t) => {
  const { root } = cleanProject(t);
  edit(root, 'CLAUDE.md', (text) => text.replace(fragment('docs-policy'), fragment('docs-policy', 'pre-0.1.0')));
  const run = check(root);
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes(`\n    CLAUDE.md  no ${fragmentVersion('docs-policy')} docs-policy fragment — run /honest-docs:update\n`));
});

test('scripts: without package.json every npm run a doc names is a problem', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, 'package.json'));
  assertOnly(check(root), 'scripts', '_docs/features/alpha.md:10  no npm script: test — no package.json');
});

test('without package.json and no npm run in the docs, nothing is reported', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, 'package.json'));
  edit(root, '_docs/features/alpha.md', (text) => text.replace(' and `npm run test`', ''));
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
});

test('index: no CLAUDE.md is one problem, and the other checks still run', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, 'CLAUDE.md'));
  edit(root, '_docs/features/alpha.md', (text) => `${text}\nSee [gone](../gone.md).\n`);
  const run = check(root);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^  index \(1\)\n    CLAUDE\.md  not found$/m);
  assert.ok(run.stderr.includes('\n    _docs/features/alpha.md:12  no such file: ../gone.md\n'), run.stderr);
  // The fragments /init writes into CLAUDE.md are missing too.
  assert.match(run.stderr, /^  init \(2\)$/m);
  assert.doesNotMatch(run.stderr, /ENOENT|\n    at /);
});

test('links: a symlink to nothing in a scanned folder', (t) => {
  const { root } = cleanProject(t);
  mkdirSync(path.join(root, '.claude/skills'));
  try {
    symlinkSync(path.join(root, 'nowhere'), path.join(root, '.claude/skills/gone'));
  } catch (error) {
    // Windows without Developer Mode or admin rights may not create symlinks.
    if (error.code !== 'EPERM') throw error;
    t.skip(`symlinkSync: ${error.message}`);
    return;
  }
  assertOnly(check(root), 'links', '.claude/skills/gone  symlink to a file that does not exist');
});

test('links: a tracked symlink to nothing in a scanned folder', (t) => {
  const { root } = cleanProject(t);
  mkdirSync(path.join(root, '.claude/skills'));
  try {
    symlinkSync(path.join(root, 'nowhere'), path.join(root, '.claude/skills/gone'));
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip(`symlinkSync: ${error.message}`);
    return;
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'symlink');
  assertOnly(check(root), 'links', '.claude/skills/gone  symlink to a file that does not exist');
});

/**
 * One person's notes in the docs folder: a broken link, no Last Updated line, a covers glob that
 * matches nothing, and a page in an index group the index does not list.
 */
const NOTES = {
  '_docs/priv/notes.md': "---\ncovers:\n  - 'lib/**'\n---\n\n# Notes\n\nSee [gone](gone.md).\n",
  '_docs/features/scratch.md': '# Scratch\n',
};
const NOTES_IGNORED = '_docs/priv/\n_docs/features/scratch.md\n';

test('an ignored doc is not checked: no link, updated, covers or index problem', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { ...NOTES, '.gitignore': NOTES_IGNORED });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'docs-check: 4 files, no problems\n');
});

for (const state of ['tracked', 'untracked']) {
  test(`the same notes ${state} are checked like any doc`, (t) => {
    const { root } = cleanProject(t);
    writeFiles(root, NOTES);
    if (state === 'tracked') {
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'notes');
    }
    const run = check(root);
    assert.equal(run.status, 1);
    for (const line of [
      '_docs/priv/notes.md:8  no such file: gone.md',
      '_docs/priv/notes.md  no **Last Updated:** line — add one under the H1, any date; the guard gate sets it',
      '_docs/features/scratch.md  no **Last Updated:** line — add one under the H1, any date; the guard gate sets it',
      '_docs/priv/notes.md  covers matches no file: lib/**',
      'CLAUDE.md  page missing from the docs index: _docs/features/scratch.md',
    ])
      assert.ok(run.stderr.includes(`\n    ${line}\n`), `expected line "${line}" in:\n${run.stderr}`);
    assert.match(run.stderr, /^docs-check: 5 problem\(s\) in 6 files$/m);
  });
}

test('without git the folders are walked on disk, ignored files included, and it says so', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { ...NOTES, '.gitignore': NOTES_IGNORED });
  rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const run = check(root);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^docs-check: git unavailable, ignored files could not be told apart and covers globs not matched against files$/m);
  assert.ok(run.stderr.includes('\n    _docs/priv/notes.md:8  no such file: gone.md\n'), run.stderr);
  // Without git the covers globs are not matched, so 4 of the 5.
  assert.match(run.stderr, /^docs-check: 4 problem\(s\) in 6 files$/m);
});

/** A doc naming paths under `artifacts/`, which git ignores: they exist on one machine and not the next. */
function artifactsProject(t, { onDisk }) {
  const project = cleanProject(t);
  writeFiles(project.root, { '.gitignore': 'artifacts/\n' });
  if (onDisk) writeFiles(project.root, { 'artifacts/other.log': '' });
  edit(
    project.root,
    '_docs/tools/beta.md',
    (text) => `${text}\nState in \`artifacts/a/b.txt\`, \`artifacts/logs/\`, \`artifacts/a.log:3\`, [log](../../artifacts/x.log#L2).\n`
  );
  return project;
}

for (const onDisk of [false, true]) {
  test(`paths and links git ignores are not reported, ${onDisk ? 'with' : 'without'} the folder on disk`, (t) => {
    const { root } = artifactsProject(t, { onDisk });
    const run = check(root);
    assert.equal(run.status, 0, run.stderr);
  });
}

test('a missing path git does not ignore is still reported beside an ignored one', (t) => {
  const { root } = artifactsProject(t, { onDisk: true });
  edit(root, '_docs/tools/beta.md', (text) => `${text}\nSee \`src/gone.ts\`.\n`);
  assertOnly(check(root), 'paths', '_docs/tools/beta.md:11  no such path: src/gone.ts');
});

test('without git a path under an ignored folder on disk is reported as before', (t) => {
  const { root } = artifactsProject(t, { onDisk: true });
  rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const run = check(root);
  assert.equal(run.status, 1);
  for (const line of [
    '_docs/tools/beta.md:9  no such file: ../../artifacts/x.log',
    '_docs/tools/beta.md:9  no such path: artifacts/a/b.txt',
    '_docs/tools/beta.md:9  no such path: artifacts/logs',
    '_docs/tools/beta.md:9  no such path: artifacts/a.log',
  ])
    assert.ok(run.stderr.includes(`\n    ${line}\n`), `expected line "${line}" in:\n${run.stderr}`);
  assert.match(run.stderr, /^docs-check: 4 problem\(s\) in 4 files$/m);
});

const LINE_NUMBER = (kind, token) => `line number in a ${kind}: ${token} — name the file, a symbol or a heading instead`;

for (const spec of ['12', '12-30', '43,60', '576/588']) {
  test(`paths: a line number (:${spec}) on a repo path that exists`, (t) => {
    const { root } = cleanProject(t);
    edit(root, '_docs/tools/beta.md', (text) => `${text}\nSee \`src/alpha.ts:${spec}\`.\n`);
    assertOnly(check(root), 'paths', `_docs/tools/beta.md:9  ${LINE_NUMBER('path', `src/alpha.ts:${spec}`)}`);
  });
}

for (const token of ['src/alpha.ts:12:5', 'alpha.ts:12:5']) {
  test(`paths: line:column on ${token.includes('/') ? 'a repo path' : 'a bare file name'} is a line number`, (t) => {
    const { root } = cleanProject(t);
    edit(root, '_docs/tools/beta.md', (text) => `${text}\nSee \`${token}\`.\n`);
    assertOnly(check(root), 'paths', `_docs/tools/beta.md:9  ${LINE_NUMBER('path', token)}`);
  });
}

test('paths: a line number on a repo path that is gone is a missing path, once', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/tools/beta.md', (text) => `${text}\nSee \`src/gone.ts:12-30\`.\n`);
  assertOnly(check(root), 'paths', '_docs/tools/beta.md:9  no such path: src/gone.ts');
});

test('paths: a line number on a bare file name the repo has', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/tools/beta.md', (text) => `${text}\nSee \`alpha.ts:12\`.\n`);
  assertOnly(check(root), 'paths', `_docs/tools/beta.md:9  ${LINE_NUMBER('path', 'alpha.ts:12')}`);
});

test('paths: a bare name no repo file has, and host:port tokens, are not reported', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/tools/beta.md', (text) => `${text}\n\`gone.ts:12\`, \`localhost:8081\`, \`api.example.com:443\`.\n`);
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
});

for (const anchor of ['L12', 'L12-L30']) {
  test(`anchors: a link to the line anchor #${anchor}`, (t) => {
    const { root } = cleanProject(t);
    edit(root, '_docs/tools/beta.md', (text) => `${text}\nSee [alpha](../../src/alpha.ts#${anchor}).\n`);
    assertOnly(check(root), 'anchors', `_docs/tools/beta.md:9  ${LINE_NUMBER('link', `../../src/alpha.ts#${anchor}`)}`);
  });
}

test('an ignored doc with a line number is not reported', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, {
    '.gitignore': '_docs/priv/\n',
    '_docs/priv/notes.md': '# Notes\n\n`src/alpha.ts:12`, [a](../../src/alpha.ts#L12)\n',
  });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
});

for (const [text, detail] of [
  ['{ not json', 'not valid JSON \\(.+\\)'],
  ['{ "guard": { "command": "bash scripts/guard.sh" } }', 'guard\\.command must be an array of strings, like .+'],
  ['{ "guard": { "command": [] } }', 'guard\\.command must be an array of strings, like .+'],
  ['{ "guard": { "command": ["node", 1] } }', 'guard\\.command must be an array of strings, like .+'],
  ['{ "guard": "bash scripts/guard.sh" }', 'guard must be an object, like .+'],
]) {
  test(`a broken config (${text}): exit 2 with one line naming the file, no stack trace`, (t) => {
    const { root } = cleanProject(t);
    writeFiles(root, { '.claude/honest-docs.json': text });
    const run = check(root);
    assert.equal(run.status, 2);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, new RegExp(`^docs-check: \\.claude/honest-docs\\.json: ${detail}\\n$`));
  });
}

const checkJson = (root) => runScript('docs-check', ['--json'], { cwd: root });

/** The problems --json reports, after asserting it exited 0 with nothing on stderr. */
function jsonProblems(run) {
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  return JSON.parse(run.stdout).problems;
}

test('--json on a clean project: the file count and no problems, exit 0', (t) => {
  const { root } = cleanProject(t);
  const run = checkJson(root);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { files: 4, problems: [] });
});

test('--json lists every finding with check, file, line, message, target and related, and exits 0', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, {
    '_docs/tools/c.md': '---\ncovers: []\n---\n\n# C\n\n**Last Updated:** x\n',
    '_docs/features/gamma.md': '# Gamma\n\n**Last Updated:** x\n',
    '.claude/rules/extra.md': '# Extra\n',
  });
  edit(root, 'CLAUDE.md', (text) =>
    text
      .replace(`${fragment('docs-policy')}\n`, '')
      .replace('- [Beta]', '- [Gone](_docs/tools/gone.md)\n- [Beta]')
      .replace('- [docs](.claude/rules/docs.md)', '- [docs](.claude/rules/docs.md)\n- [x](.claude/rules/x.md)')
  );
  edit(root, '_docs/features/alpha.md', (text) =>
    text.replace("  - 'src/**'", "  - 'src/**'\n  - 'lib/**'").replace('#details', '#nope') +
      '[g](../gone.md) [l](../../src/alpha.ts#L3) [s](#nope)\n' +
      '`src/gone.ts` `src/gonedir/` `src/alpha.ts:4` `alpha.ts:5` `npm run nope`\n'
  );
  edit(root, '_docs/tools/beta.md', (text) => text.replace('**Last Updated:** 2026-01-01 10:00 CET\n\n', ''));
  edit(root, '.claude/rules/docs.md', (text) => text.replace('One fact, one home', 'One fact, two homes'));

  const problems = jsonProblems(checkJson(root));
  const lineNumber = (kind, token) => `line number in a ${kind}: ${token} — name the file, a symbol or a heading instead`;
  const alpha = '_docs/features/alpha.md';
  const p = (check, file, line, message, target, related) => ({ check, file, line, message, target, related });
  assert.deepEqual(problems, [
    p('links', 'CLAUDE.md', 9, 'no such file: _docs/tools/gone.md', '_docs/tools/gone.md', ['_docs/tools/gone.md']),
    p('links', 'CLAUDE.md', 15, 'no such file: .claude/rules/x.md', '.claude/rules/x.md', ['.claude/rules/x.md']),
    p('anchors', alpha, 11, 'no heading "#nope" in ../tools/beta.md', null, ['_docs/tools/beta.md']),
    p('links', alpha, 12, 'no such file: ../gone.md', '_docs/gone.md', ['_docs/gone.md']),
    p('anchors', alpha, 12, lineNumber('link', '../../src/alpha.ts#L3'), 'src/alpha.ts', []),
    p('anchors', alpha, 12, 'no heading "#nope" in this file', null, [alpha]),
    p('paths', alpha, 13, 'no such path: src/gone.ts', 'src/gone.ts', ['src/gone.ts']),
    p('paths', alpha, 13, 'no such path: src/gonedir', 'src/gonedir/', ['src/gonedir']),
    p('paths', alpha, 13, lineNumber('path', 'src/alpha.ts:4'), 'src/alpha.ts', []),
    p('paths', alpha, 13, lineNumber('path', 'alpha.ts:5'), null, []),
    p('scripts', alpha, 13, 'no npm script: nope', null, ['package.json']),
    p('updated', '_docs/tools/beta.md', 0, 'no **Last Updated:** line — add one under the H1, any date; the guard gate sets it', null, []),
    p('index', 'CLAUDE.md', 0, 'page missing from the docs index: _docs/features/gamma.md', null, ['_docs/features/gamma.md']),
    p('index', 'CLAUDE.md', 0, 'page missing from the docs index: _docs/tools/c.md', null, ['_docs/tools/c.md']),
    p('index', 'CLAUDE.md', 0, 'docs index lists a page that is gone: _docs/tools/gone.md', null, ['_docs/tools/gone.md']),
    p('index', 'CLAUDE.md', 0, 'rule missing from the Rules index: .claude/rules/extra.md', null, ['.claude/rules/extra.md']),
    p('index', 'CLAUDE.md', 0, 'Rules index lists a rule that is gone: .claude/rules/x.md', null, ['.claude/rules/x.md']),
    p('covers', '_docs/tools/c.md', 0, 'covers: declared, but no glob could be read from it', null, []),
    p('covers', alpha, 0, 'covers matches no file: lib/**', null, []),
    p('init', '.claude/rules/docs.md', 0, 'differs from the rule this plugin writes — run /honest-docs:update', null, ['.claude/honest-docs.json']),
    p('init', 'CLAUDE.md', 0, `no ${fragmentVersion('docs-policy')} docs-policy fragment — run /honest-docs:update`, null, []),
  ]);

  // The same problems as the text output, which is unchanged.
  const text = check(root);
  assert.equal(text.status, 1);
  for (const f of problems) assert.ok(text.stderr.includes(`\n    ${f.file}${f.line ? `:${f.line}` : ''}  ${f.message}\n`), f.message);
  assert.match(text.stderr, new RegExp(`^docs-check: ${problems.length} problem\\(s\\) in 7 files$`, 'm'));
});

test('related: a missing heading names the page that should hold it', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text.replace('#details', '#nope'));
  const [problem] = jsonProblems(checkJson(root));
  assert.equal(problem.message, 'no heading "#nope" in ../tools/beta.md');
  assert.deepEqual(problem.related, ['_docs/tools/beta.md']);
});

test('related: a scripts finding names package.json, even when git ignores it', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { '.gitignore': 'package.json\n' });
  edit(root, '_docs/features/alpha.md', (text) => text.replace('npm run test', 'npm run nope'));
  const [problem] = jsonProblems(checkJson(root));
  assert.equal(problem.message, 'no npm script: nope');
  assert.deepEqual(problem.related, ['package.json']);
});

test('related: a page missing from the index names the page', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { '_docs/features/gamma.md': BETA.replace('Beta', 'Gamma') });
  const [problem] = jsonProblems(checkJson(root));
  assert.equal(problem.message, 'page missing from the docs index: _docs/features/gamma.md');
  assert.deepEqual(problem.related, ['_docs/features/gamma.md']);
});

test('related: no index file names nothing, a missing docs rule names the config', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, 'CLAUDE.md'));
  rmSync(path.join(root, '.claude/rules/docs.md'));
  const problems = jsonProblems(checkJson(root));
  assert.deepEqual(
    problems.map(({ check, file, related }) => ({ check, file, related })),
    [
      { check: 'index', file: 'CLAUDE.md', related: [] },
      { check: 'init', file: '.claude/rules/docs.md', related: ['.claude/honest-docs.json'] },
      { check: 'init', file: 'CLAUDE.md', related: [] },
      { check: 'init', file: 'CLAUDE.md', related: [] },
    ]
  );
});

test('related: a symlink to nothing names what it pointed at, when that is in the repo', (t) => {
  const { root, dir } = cleanProject(t);
  mkdirSync(path.join(root, '.claude/skills'));
  try {
    symlinkSync('../../src/gone.ts', path.join(root, '.claude/skills/inside'));
    symlinkSync(path.join(dir, 'outside'), path.join(root, '.claude/skills/outside'));
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip(`symlinkSync: ${error.message}`);
    return;
  }
  assert.deepEqual(
    jsonProblems(checkJson(root)).map(({ file, related }) => ({ file, related })),
    [
      { file: '.claude/skills/inside', related: ['src/gone.ts'] },
      { file: '.claude/skills/outside', related: [] },
    ]
  );
});

test('--json with a broken config: exit 2 with one line naming the file, nothing on stdout', (t) => {
  const { root } = cleanProject(t);
  writeFiles(root, { '.claude/honest-docs.json': '{ not json' });
  const run = checkJson(root);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^docs-check: \.claude\/honest-docs\.json: not valid JSON \(.+\)\n$/);
});

test('--json without git: stdout is only the JSON, the git line goes to stderr', (t) => {
  const { root } = cleanProject(t);
  rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const run = checkJson(root);
  assert.equal(run.status, 0);
  assert.match(run.stderr, /^docs-check: git unavailable/);
  assert.deepEqual(JSON.parse(run.stdout), { files: 4, problems: [] });
});

test('--json prints a long list whole through a pipe', (t) => {
  const { root } = cleanProject(t);
  edit(root, '_docs/features/alpha.md', (text) => text + '[gone](../gone-with-a-long-name-to-fill-the-pipe.md)\n'.repeat(3000));
  assert.equal(jsonProblems(checkJson(root)).length, 3000);
});

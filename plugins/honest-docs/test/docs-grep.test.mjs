// honest-docs-grep (scripts/docs-grep.mjs): every doc line naming a symbol, in the scanned places only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBin, tmpRepo, writeFiles } from './helpers.mjs';

function project(t) {
  return tmpRepo(t, {
    'CLAUDE.md': '# Project\n\nUse `fetchUser` for users.\n',
    'README.md': 'fetchUser is documented in _docs.\n',
    '_docs/features/users.md': '# Users\n\nNo match here.\n\n`fetchUser()` retries twice.\n',
    '.claude/rules/api.md': 'Call fetchUser, never fetch.\n',
    '.claude/skills/x/SKILL.md': 'Nothing.\n',
    'src/users.ts': 'export function fetchUser() {}\n', // not a doc
    'notes/fetchUser.md': 'fetchUser outside the scanned folders.\n',
    '.gitignore': '_docs/priv/\n',
  });
}

const grep = (root, ...symbols) => runBin('honest-docs-grep', symbols, { cwd: root });

test('lists every scanned doc line naming the symbol, sorted by file', (t) => {
  const { root } = project(t);
  const run = grep(root, 'fetchUser');
  assert.equal(run.status, 0);
  assert.equal(
    run.stdout,
    [
      '== fetchUser',
      '.claude/rules/api.md:1: Call fetchUser, never fetch.',
      'CLAUDE.md:3: Use `fetchUser` for users.',
      'README.md:1: fetchUser is documented in _docs.',
      '_docs/features/users.md:5: `fetchUser()` retries twice.',
      '',
    ].join('\n')
  );
});

test('several symbols, one block each, and "no matches"', (t) => {
  const { root } = project(t);
  const run = grep(root, 'never fetch', 'missingSymbol');
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '== never fetch\n.claude/rules/api.md:1: Call fetchUser, never fetch.\n\n== missingSymbol\nno matches\n');
});

test('case-sensitive, literal substring', (t) => {
  const { root } = project(t);
  assert.match(grep(root, 'FETCHUSER').stdout, /no matches/);
  assert.match(grep(root, 'fetchUser()').stdout, /_docs\/features\/users\.md:5:/);
});

test('an untracked doc is searched, a gitignored one is not', (t) => {
  const { root } = project(t);
  writeFiles(root, { '_docs/features/new.md': 'fetchUser in a new doc.\n', '_docs/priv/scratch.md': 'fetchUser in scratch.\n' });
  const run = grep(root, 'fetchUser');
  assert.match(run.stdout, /^_docs\/features\/new\.md:1: /m);
  assert.doesNotMatch(run.stdout, /scratch/);
});

test('a long line is clipped to 160 characters', (t) => {
  const { root } = project(t);
  writeFiles(root, { '_docs/long.md': `   fetchUser ${'x'.repeat(300)}\n` });
  const line = grep(root, 'fetchUser').stdout.split('\n').find((l) => l.startsWith('_docs/long.md'));
  const text = line.slice('_docs/long.md:1: '.length);
  assert.equal(text.length, 160);
  assert.ok(text.startsWith('fetchUser '));
  assert.ok(text.endsWith('…'));
});

test('no symbol: usage on stderr, exit 64', (t) => {
  const { root } = project(t);
  const run = grep(root);
  assert.equal(run.status, 64);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, 'usage: honest-docs-grep <symbol> [<symbol>...]\n');
});

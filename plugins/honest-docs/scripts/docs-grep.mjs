#!/usr/bin/env node
// Lists every line of the project's instruction docs that names a given symbol, so a change that
// renamed, removed or changed the behavior of a name can fix the sentences it made false. Called
// from the Docs policy in CLAUDE.md as `honest-docs-grep` (bin/).
//
// The searched locations are the config's `scan` (core/config.mjs) — the root instructions name the
// command, not the folders.
//
// Usage:  honest-docs-grep <symbol> [<symbol>...]
//
// Matching is a literal, case-sensitive substring test, line by line. Exit 0 whether or not
// anything matched; 64 on a usage error, 1 when git is unavailable.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, projectRoot } from '../core/config.mjs';
import { logEvent } from '../core/log.mjs';

const ROOT = projectRoot();
const config = loadConfig(ROOT);

const DIRS = config.scan.dirs.map((dir) => `${dir.replace(/\/+$/, '')}/`);
const ROOT_FILES = config.scan.files;
const MAX_LINE = 160;

const symbols = process.argv.slice(2);
if (symbols.length === 0) {
  console.error('usage: honest-docs-grep <symbol> [<symbol>...]');
  process.exit(64);
}

// Tracked and untracked-but-not-ignored: a doc written in the same change is searched, and a
// gitignored scratch folder is not.
let listed;
try {
  listed = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  console.error('docs-grep: git unavailable, cannot list the docs to search');
  process.exit(1);
}

const docs = [
  ...new Set(
    listed.split('\0').filter((f) => f.endsWith('.md') && (ROOT_FILES.includes(f) || DIRS.some((d) => f.startsWith(d))))
  ),
].sort();

// A file deleted from disk but still in the index is skipped rather than failing the run.
const contents = docs.flatMap((file) => {
  try {
    return [{ file, lines: readFileSync(join(ROOT, file), 'utf8').split('\n') }];
  } catch {
    return [];
  }
});

const clip = (text) => {
  const trimmed = text.trim();
  return trimmed.length > MAX_LINE ? `${trimmed.slice(0, MAX_LINE - 1)}…` : trimmed;
};

let total = 0;
symbols.forEach((symbol, i) => {
  if (i > 0) console.log('');
  console.log(`== ${symbol}`);
  let hits = 0;
  for (const { file, lines } of contents) {
    lines.forEach((text, n) => {
      if (!text.includes(symbol)) return;
      hits++;
      console.log(`${file}:${n + 1}: ${clip(text)}`);
    });
  }
  if (hits === 0) console.log('no matches');
  total += hits;
});
logEvent(ROOT, 'docs-grep', { symbols: symbols.length, hits: total });

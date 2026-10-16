#!/usr/bin/env node
// Lists every line of the project's instruction docs that names a given symbol, so a change that
// renamed, removed or changed the behavior of a name can fix the sentences it made false. Called
// from the Docs policy in CLAUDE.md as `honest-docs-grep` (bin/).
//
// The searched docs are the config's `scan` (core/config.mjs), files git ignores left out
// (core/doc-set.mjs) — the root instructions name the command, not the folders.
//
// Usage:  honest-docs-grep <symbol> [<symbol>...]
//
// Matching is a literal, case-sensitive substring test, line by line. Exit 0 whether or not
// anything matched; 64 on a usage error, 2 on a broken config.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig, projectRoot } from '../core/config.mjs';
import { docSet } from '../core/doc-set.mjs';
import { logEvent } from '../core/log.mjs';

const ROOT = projectRoot();
let config;
try {
  config = loadConfig(ROOT);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`docs-grep: ${error.message}`);
  process.exit(2);
}

const MAX_LINE = 160;

const symbols = process.argv.slice(2);
if (symbols.length === 0) {
  console.error('usage: honest-docs-grep <symbol> [<symbol>...]');
  process.exit(64);
}

const { docs, git } = docSet(ROOT, config);
if (!git) console.error('docs-grep: git unavailable, ignored files could not be told apart');

// A file that cannot be read is skipped rather than failing the run.
const contents = docs.sort().flatMap((file) => {
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

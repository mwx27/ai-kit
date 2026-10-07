#!/usr/bin/env node
// Static counter for the instruction layer's context budget.
//
// Answers one question before any cut is made: how many lines of instruction does a session
// actually carry, given the files it touches? The rules load on the *read* of a matching path,
// so the budget is a function of the file set, not a constant — hence the file list as input.
//
// COUNTING CONVENTION (must not change; every later measurement is compared against this one):
//   - raw `wc -l` semantics: newline count of the whole file, frontmatter included
//   - CLAUDE.md is always counted: it loads in every session and survives compaction
//   - a rule is counted once, whole, if any input path matches any of its `paths:` globs
//   - skills and _docs/ are out of scope: they load on demand, not on a path match
//
// Usage:  node <plugin>/scripts/context-budget.mjs app/index.tsx components/Button.tsx
//         node <plugin>/scripts/context-budget.mjs --all        # every rule, ignoring globs
//
// Run from inside the project; the root is the enclosing git repository (core/config.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../core/config.mjs';

const ROOT = projectRoot();
const RULES_DIR = path.join(ROOT, '.claude', 'rules');
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');

const countLines = (file) => {
  const text = readFileSync(file, 'utf8');
  if (text === '') return 0;
  const n = (text.match(/\n/g) ?? []).length;
  return text.endsWith('\n') ? n : n + 1;
};

const escapeRe = (c) => (/[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c);

/** Minimal glob → RegExp: supports **, *, ?, {a,b}. Paths are POSIX, relative to the repo root. */
const globToRegExp = (glob) => {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(',')
          .map((opt) => [...opt].map(escapeRe).join(''))
          .join('|')})`;
        i = end;
      }
    } else {
      re += escapeRe(c);
    }
  }
  // Claude Code matches these globs unanchored: `hooks/**` fires on .claude/hooks/x.mjs, not only
  // on a top-level hooks/. Verified against a live InstructionsLoaded trigger. Anchoring here
  // under-reports every session that touches .claude/ or scripts/.
  // Do not merge this matcher with core/doc-covers.mjs: that one anchors `covers:` globs at
  // the repo root, this one reproduces Claude Code's unanchored `paths:` matching, and the
  // budget measurements stand on it.
  const floating = glob.startsWith('**') ? '' : '(?:.*/)?';
  return new RegExp(`^${floating}${re}$`);
};

/** `paths:` entries out of the YAML frontmatter. Only the one key is needed, so no YAML parser. */
const readRule = (file) => {
  const text = readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const globs = [];
  if (fm) {
    let inPaths = false;
    for (const line of fm[1].split('\n')) {
      if (/^paths:\s*$/.test(line)) {
        inPaths = true;
        continue;
      }
      if (inPaths) {
        const m = line.match(/^\s*-\s*['"]?(.+?)['"]?\s*$/);
        if (m) globs.push(m[1]);
        else if (line.trim() !== '') inPaths = false;
      }
    }
  }
  return { name: path.basename(file), globs, lines: countLines(file) };
};

const inputs = process.argv.slice(2);
const all = inputs.includes('--all');
const files = inputs.filter((a) => !a.startsWith('--')).map((f) => f.split(path.sep).join('/'));

if (!all && files.length === 0) {
  console.error('usage: context-budget.mjs <file>... | --all');
  process.exit(1);
}

const rules = readdirSync(RULES_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) => readRule(path.join(RULES_DIR, f)));

const base = countLines(CLAUDE_MD);
let total = base;

console.log(`input: ${all ? '--all (globs ignored)' : files.join(', ')}\n`);
console.log('rule                        lines  matched by');
console.log('-'.repeat(72));
console.log(`${'CLAUDE.md'.padEnd(26)}${String(base).padStart(6)}  always`);

for (const rule of rules) {
  const hit = all ? ['--all'] : rule.globs.filter((g) => files.some((f) => globToRegExp(g).test(f)));
  if (hit.length === 0) continue;
  total += rule.lines;
  console.log(`${rule.name.padEnd(26)}${String(rule.lines).padStart(6)}  ${hit.join(', ')}`);
}

console.log('-'.repeat(72));
console.log(`${'TOTAL'.padEnd(26)}${String(total).padStart(6)}`);

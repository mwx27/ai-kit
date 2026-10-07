#!/usr/bin/env node
// Checks the project's docs against the tree: links, anchors, backticked paths, `npm run` names, the
// docs index, `covers:` globs, the Last Updated line and what /honest-docs:init wrote. Run as
// `honest-docs-check` (bin/), or by the project's guard through $HONEST_DOCS_SCRIPTS. What it scans
// and what it accepts as absent comes from .claude/honest-docs.json (core/config.mjs).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadConfig, projectRoot, skippedRoots } from '../core/config.mjs';
import { readCovers } from '../core/doc-covers.mjs';
import { checkInit } from '../core/init.mjs';
import { LAST_UPDATED_LINE } from '../core/last-updated.mjs';
import { logEvent } from '../core/log.mjs';

const ROOT = projectRoot();
const config = loadConfig(ROOT);
const DOCS_DIR = config.docsDir;

/**
 * Paths a doc may name that are absent from a clean checkout. Every entry is a deliberate
 * statement that the path is generated or aspirational, not a typo — which is why it is a list in
 * the config and not a heuristic.
 */
const ABSENT_BY_DESIGN = config.absentByDesign;

/** Scripts a doc names while saying they do not exist. */
const ABSENT_SCRIPTS = config.absentScripts;

/**
 * Root-level files a doc has no reason to name unless they are real. Bare filenames elsewhere
 * (`store.ts`, `PascalCase.tsx`) are conventions or folder-relative and are not checked at all —
 * an earlier version did, and produced sixty false positives against a clean tree.
 */
const ROOT_FILES = config.rootFiles;

const SKIPPED = skippedRoots(config);
const UNDATED = config.undated.map((dir) => `${dir.replace(/\/+$/, '')}/`);

const findings = [];
const report = (check, file, line, message) => findings.push({ check, file, line, message });

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const docs = [
  ...config.scan.dirs.flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : [])),
  ...config.scan.files.map((f) => join(ROOT, f)).filter(existsSync),
];

/**
 * GitHub's slugger. Two of its rules are worth reproducing exactly: punctuation is deleted rather
 * than replaced, and the spaces around it survive — so "Errors — `ApiError`" becomes
 * `errors--apierror`, with a gap where the dash was. Collapsing whitespace here reports live
 * anchors as broken.
 */
const slug = (heading) =>
  heading
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');

const headings = new Map(
  docs.map((doc) => [
    doc,
    new Set(
      readFileSync(doc, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('#'))
        .map(slug)
    ),
  ])
);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const trimSlash = (p) => p.replace(/\/$/, '');
const isAbsentByDesign = (p) =>
  ABSENT_BY_DESIGN.map(trimSlash).some((a) => trimSlash(p) === a || trimSlash(p).startsWith(`${a}/`));

for (const doc of docs) {
  const rel = relative(ROOT, doc);
  const lines = readFileSync(doc, 'utf8').split('\n');

  /*
   * The guard gate only rewrites a date line that is already there, and the docs rule that asks for
   * one did not load when a doc was created with Write (observed, September 2026; the Claude Code
   * documentation says Write loads it) — so a new doc without it would go undated forever. Failing
   * here stops the turn; any date will do, the gate sets the real one on the next stop.
   */
  if (rel.startsWith(`${DOCS_DIR}/`) && !UNDATED.some((dir) => rel.startsWith(dir))) {
    const dated = lines.filter((text) => LAST_UPDATED_LINE.test(text)).length;
    if (dated !== 1)
      report(
        'updated',
        rel,
        0,
        dated === 0
          ? 'no **Last Updated:** line — add one under the H1, any date; the guard gate sets it'
          : `${dated} lines start with **Last Updated:**, expected one`
      );
  }

  lines.forEach((text, i) => {
    const line = i + 1;

    /*
     * Code spans are blanked first, so a link quoted as an example is not followed. The
     * angle-bracket form is what prettier writes for a path holding parentheses; a pattern that
     * stops at the first ")" reports `app/(tabs)/index.tsx` as missing.
     */
    const prose = text.replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));
    for (const m of prose.matchAll(/\]\((?:<([^>]+)>|([^()\s]*(?:\([^()]*\)[^()\s]*)*))\)/g)) {
      const raw = (m[1] ?? m[2] ?? '').trim();
      if (!raw || /^(https?:|mailto:)/.test(raw)) continue;
      const [target, anchor] = raw.split('#');
      const file = target ? resolve(dirname(doc), target) : doc;
      if (target && !existsSync(file)) {
        if (!isAbsentByDesign(relative(ROOT, file))) report('links', rel, line, `no such file: ${target}`);
        continue;
      }
      if (anchor && headings.has(file) && !headings.get(file).has(anchor)) {
        report('anchors', rel, line, `no heading "#${anchor}" in ${target || 'this file'}`);
      }
    }

    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1].trim().replace(/\/$/, '');
      if (/[{}*<>?|\s]/.test(token) || token.includes('://') || token.startsWith('/')) continue;

      const head = token.split('/')[0];
      const isRootFile = ROOT_FILES.includes(token);
      // `./config.js`, `../utils`: import specifiers quoted in prose, not repo paths.
      const isRepoPath = token.includes('/') && head !== '.' && head !== '..' && existsSync(join(ROOT, head));
      if (!isRootFile && !isRepoPath) continue;
      if (existsSync(join(ROOT, token)) || isAbsentByDesign(token)) continue;
      report('paths', rel, line, `no such path: ${token}`);
    }

    for (const m of text.matchAll(/npm run ([a-z0-9:_-]+)(\*?)/g)) {
      const [, name, glob] = m;
      if (glob || ABSENT_SCRIPTS.includes(name) || pkg.scripts?.[name]) continue;
      report('scripts', rel, line, `no npm script: ${name}`);
    }
  });
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { file: INDEX_FILE, groups: INDEX_GROUPS, rulesHeading: RULES_HEADING } = config.index;

const claudeMd = readFileSync(join(ROOT, INDEX_FILE), 'utf8');
const indexPattern = new RegExp(
  `${escapeRe(DOCS_DIR)}\\/(?:${INDEX_GROUPS.map(escapeRe).join('|')})\\/[\\w.-]+\\.md`,
  'g'
);
const indexed = new Set(INDEX_GROUPS.length > 0 ? (claudeMd.match(indexPattern) ?? []) : []);
for (const group of INDEX_GROUPS) {
  const dir = join(ROOT, DOCS_DIR, group);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    if (!indexed.has(`${DOCS_DIR}/${group}/${entry}`))
      report('index', INDEX_FILE, 0, `page missing from the docs index: ${DOCS_DIR}/${group}/${entry}`);
  }
}
for (const entry of indexed) {
  if (!existsSync(join(ROOT, entry))) report('index', INDEX_FILE, 0, `docs index lists a page that is gone: ${entry}`);
}

// Only the Rules section counts: the index file links a rule from other sections too, and a link
// there does not put it in the index.
const rulesSection =
  claudeMd.match(new RegExp(`^## ${escapeRe(RULES_HEADING)}\\b[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm'))?.[0] ?? '';
const indexedRules = new Set(rulesSection.match(/\.claude\/rules\/[\w.-]+\.md/g) ?? []);
const rulesDir = join(ROOT, '.claude', 'rules');
if (existsSync(rulesDir)) {
  for (const entry of readdirSync(rulesDir).filter((f) => f.endsWith('.md'))) {
    if (!indexedRules.has(`.claude/rules/${entry}`))
      report('index', INDEX_FILE, 0, `rule missing from the ${RULES_HEADING} index: .claude/rules/${entry}`);
  }
}
for (const entry of indexedRules) {
  if (!existsSync(join(ROOT, entry)))
    report('index', INDEX_FILE, 0, `${RULES_HEADING} index lists a rule that is gone: ${entry}`);
}

// Reading the globs needs no git, so a key the parser cannot read fails even where git is missing.
const covers = readCovers(ROOT, DOCS_DIR);
for (const { doc, globs } of covers) {
  if (globs.length === 0) report('covers', doc, 0, 'covers: declared, but no glob could be read from it');
}

/*
 * Tracked and untracked-but-not-ignored, so a doc written alongside a feature not yet added to git
 * passes; the existsSync drops a file deleted from disk but still in the index.
 */
let repoFiles = null;
try {
  repoFiles = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\0')
    .filter((file) => file && existsSync(join(ROOT, file)));
} catch {
  console.log('docs-check: git unavailable, covers globs not matched against files');
}
if (repoFiles) {
  for (const { doc, globs, patterns } of covers) {
    globs.forEach((glob, i) => {
      if (!repoFiles.some((file) => patterns[i].test(file)))
        report('covers', doc, 0, `covers matches no file: ${glob}`);
    });
  }
}

// The docs rule stamped with this plugin version, and the current CLAUDE.md fragments.
for (const { file, message } of checkInit(ROOT, config)) report('init', file, 0, message);

const CHECKS = ['links', 'anchors', 'paths', 'scripts', 'index', 'covers', 'updated', 'init'];
logEvent(ROOT, 'docs-check', {
  files: docs.length,
  problems: findings.length,
  byCheck: Object.fromEntries(
    CHECKS.map((check) => [check, findings.filter((f) => f.check === check).length]).filter(([, n]) => n > 0)
  ),
});

if (findings.length === 0) {
  console.log(`docs-check: ${docs.length} files, no problems`);
  process.exit(0);
}
for (const check of CHECKS) {
  const group = findings.filter((f) => f.check === check);
  if (!group.length) continue;
  console.error(`\n  ${check} (${group.length})`);
  for (const f of group) console.error(`    ${f.file}${f.line ? `:${f.line}` : ''}  ${f.message}`);
}
console.error(`\ndocs-check: ${findings.length} problem(s) in ${docs.length} files\n`);
process.exit(1);

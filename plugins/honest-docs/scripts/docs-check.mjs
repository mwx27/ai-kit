#!/usr/bin/env node
// Checks the project's docs against the tree: links, anchors, backticked paths, `<runner> run` names, the
// docs index, `covers:` globs, the Last Updated line and what /honest-docs:init wrote. Run as
// `honest-docs-check` (bin/), or by the project's guard through $HONEST_DOCS_SCRIPTS. What it scans
// and what it accepts as absent comes from .claude/honest-docs.json (core/config.mjs).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ConfigError, loadConfig, projectRoot } from '../core/config.mjs';
import { readCovers } from '../core/doc-covers.mjs';
import { docSet, listRepoFiles } from '../core/doc-set.mjs';
import { checkInit, listedRules, rulesSection } from '../core/init.mjs';
import { LAST_UPDATED_LINE } from '../core/last-updated.mjs';
import { logEvent } from '../core/log.mjs';
import { posixPath } from '../core/posix-path.mjs';

const ROOT = projectRoot();
let config;
try {
  config = loadConfig(ROOT);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`docs-check: ${error.message}`);
  process.exit(2);
}
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

const UNDATED = config.undated.map((dir) => `${dir.replace(/\/+$/, '')}/`);

const findings = [];
const report = (check, file, line, message) => findings.push({ check, file, line, message });

// One git call for the doc set (core/doc-set.mjs: ignored files are not docs) and the covers match.
const LISTED = listRepoFiles(ROOT);
if (!LISTED) console.log('docs-check: git unavailable, ignored files could not be told apart and covers globs not matched against files');

const scanned = docSet(ROOT, config, undefined, LISTED);
for (const file of scanned.dangling) report('links', file, 0, 'symlink to a file that does not exist');
const docs = scanned.docs.map((doc) => join(ROOT, doc));

/** The docs directly in `dir`, for the index: the same set, so an ignored page needs no entry. */
const docsIn = (dir) =>
  docSet(ROOT, config, { dirs: [dir], files: [] }, LISTED)
    .docs.filter((doc) => !doc.slice(dir.length + 1).includes('/'))
    .map((doc) => doc.slice(dir.length + 1));

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

// Not every project has one; then every script a doc runs is reported, and none is no problem.
const pkg = existsSync(join(ROOT, 'package.json')) ? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) : null;
const trimSlash = (p) => p.replace(/\/$/, '');
const isAbsentByDesign = (p) =>
  ABSENT_BY_DESIGN.map(trimSlash).some((a) => trimSlash(p) === a || trimSlash(p).startsWith(`${a}/`));

/**
 * `hooks/useAnalytics` in prose is an import specifier: the file is `hooks/useAnalytics.ts`, or a
 * folder with an index, so the token is tried with each extension and as `<token>/index.<ext>` before
 * it is reported.
 */
const SPECIFIER_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const resolvesAsSpecifier = (token) =>
  SPECIFIER_EXTENSIONS.some((ext) => existsSync(join(ROOT, `${token}${ext}`)) || existsSync(join(ROOT, token, `index${ext}`)));

/**
 * The `run` form of each package manager. Bare `yarn x` and `pnpm x` also run a dependency's binary
 * (`yarn tsc`), so a name missing from `scripts` there is no error, and they are not checked
 * (references/docs-check.md has the cost).
 */
const RUN_SCRIPT = /\b(npm|pnpm|yarn|bun) run ([a-z0-9:_-]+)(\*?)/g;

for (const doc of docs) {
  const rel = posixPath(relative(ROOT, doc));
  const lines = readFileSync(doc, 'utf8').split('\n');

  /*
   * The guard gate only rewrites a date line that is already there, and the docs rule that asks for
   * one arrives only after Write has created the doc (observed, October 2026) — so a new doc
   * without it could go undated forever. Failing here stops the turn; any date will do, the gate
   * sets the real one on the next stop.
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
        if (!isAbsentByDesign(posixPath(relative(ROOT, file)))) report('links', rel, line, `no such file: ${target}`);
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
      if (existsSync(join(ROOT, token)) || isAbsentByDesign(token) || resolvesAsSpecifier(token)) continue;
      report('paths', rel, line, `no such path: ${token}`);
    }

    for (const m of text.matchAll(RUN_SCRIPT)) {
      const [, , name, glob] = m;
      if (glob || ABSENT_SCRIPTS.includes(name) || pkg?.scripts?.[name]) continue;
      report('scripts', rel, line, pkg ? `no npm script: ${name}` : `no npm script: ${name} — no package.json`);
    }
  });
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { file: INDEX_FILE, groups: INDEX_GROUPS, rulesHeading: RULES_HEADING } = config.index;

// Without the index file there is no index to compare: one problem, and the other checks still run.
if (!existsSync(join(ROOT, INDEX_FILE))) {
  report('index', INDEX_FILE, 0, 'not found');
} else {
  const claudeMd = readFileSync(join(ROOT, INDEX_FILE), 'utf8');
  const indexPattern = new RegExp(
    `${escapeRe(DOCS_DIR)}\\/(?:${INDEX_GROUPS.map(escapeRe).join('|')})\\/[\\w.-]+\\.md`,
    'g'
  );
  const indexed = new Set(INDEX_GROUPS.length > 0 ? (claudeMd.match(indexPattern) ?? []) : []);
  for (const group of INDEX_GROUPS) {
    for (const entry of docsIn(`${DOCS_DIR}/${group}`)) {
      if (!indexed.has(`${DOCS_DIR}/${group}/${entry}`))
        report('index', INDEX_FILE, 0, `page missing from the docs index: ${DOCS_DIR}/${group}/${entry}`);
    }
  }
  for (const entry of indexed) {
    if (!existsSync(join(ROOT, entry))) report('index', INDEX_FILE, 0, `docs index lists a page that is gone: ${entry}`);
  }

  // Only the Rules section counts: the index file links a rule from other sections too, and a link
  // there does not put it in the index.
  const indexedRules = listedRules(rulesSection(claudeMd, RULES_HEADING)?.[0] ?? '');
  for (const entry of docsIn('.claude/rules')) {
    if (!indexedRules.has(`.claude/rules/${entry}`))
      report('index', INDEX_FILE, 0, `rule missing from the ${RULES_HEADING} index: .claude/rules/${entry}`);
  }
  for (const entry of indexedRules) {
    if (!existsSync(join(ROOT, entry)))
      report('index', INDEX_FILE, 0, `${RULES_HEADING} index lists a rule that is gone: ${entry}`);
  }
}

// Reading the globs needs no git, so a key the parser cannot read fails even where git is missing.
const covers = readCovers(ROOT, config, LISTED);
for (const { doc, globs } of covers) {
  if (globs.length === 0) report('covers', doc, 0, 'covers: declared, but no glob could be read from it');
}

/*
 * Tracked and untracked-but-not-ignored, so a doc written alongside a feature not yet added to git
 * passes; the existsSync drops a file deleted from disk but still in the index.
 */
const repoFiles = LISTED?.filter((file) => existsSync(join(ROOT, file)));
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

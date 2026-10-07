// /honest-docs:init: what it writes into a project, and the check docs-check runs on it.
//
//   .claude/rules/docs.md   templates/docs.md with the config's docsDir and index.file filled in;
//                           the plugin is its only author, so it is overwritten, and its last line
//                           stamps the plugin version
//   .claude/honest-docs.json  a skeleton, written only when the project has none
//   index.file (CLAUDE.md)  two fragments — the `Read` line and the docs policy — each replaced
//                           where it stands by its current version; the rest of the file is the
//                           project's
//
// A fragment is found by the words of any version in templates/fragments/<name>/, whitespace
// between them free, so a rewrap by hand or by Prettier still matches. A version named pre-<v> is
// text that predates the plugin: recognised and replaced, never written.
//
// On the first run — no docs.md, or one without a stamp — a fragment found nowhere is appended to
// the end of index.file under one `## honest-docs` heading, read-line first. The project may move
// it anywhere: later runs find it by its words. Once a stamp exists, a fragment found nowhere had
// its words changed, and that is an error. A fragment found twice is an error on every run.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from './config.mjs';
import { PLUGIN_ROOT, pluginVersion } from './log.mjs';

export const DOCS_RULE = '.claude/rules/docs.md';
export const FRAGMENTS = ['read-line', 'docs-policy'];
export const APPEND_HEADING = '## honest-docs';

const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
const STAMP = /^Written by \/honest-docs:init (\S+) — fixes go to the plugin, not this file\.$/;
const SKELETON = { docsDir: '_docs', guard: { command: null } };

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every version of a fragment, `{ version, text }`, the current one first. */
function fragmentVersions(name) {
  const dir = path.join(TEMPLATES, 'fragments', name);
  const versions = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ version: f.slice(0, -3), text: readFileSync(path.join(dir, f), 'utf8').trim() }));
  const current = versions.find((v) => v.version === pluginVersion());
  if (!current) throw new Error(`templates/fragments/${name}/ has no ${pluginVersion()}.md`);
  return [current, ...versions.filter((v) => v !== current)];
}

const wordsPattern = (text) => new RegExp(`(?<!\\S)${text.split(/\s+/).map(escapeRe).join('\\s+')}(?!\\S)`, 'g');

/**
 * Where a fragment sits in `text`: every match of any of `versions`, a match lying inside a longer
 * one dropped, so a version that is a run of words in another does not count twice.
 */
export function findFragment(text, versions) {
  const matches = versions.flatMap(({ version, text: words }) =>
    [...text.matchAll(wordsPattern(words))].map((m) => ({ version, start: m.index, end: m.index + m[0].length }))
  );
  return matches.filter(
    (m) => !matches.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start)
  );
}

export function renderDocsRule(config) {
  return readFileSync(path.join(TEMPLATES, 'docs.md'), 'utf8')
    .replaceAll('{{docsDir}}', config.docsDir)
    .replaceAll('{{indexFile}}', config.index.file)
    .replaceAll('{{version}}', pluginVersion());
}

/** The version stamped in a docs.md, or null when its last line is not a stamp. */
export function stampOf(text) {
  return text.trimEnd().split('\n').at(-1).match(STAMP)?.[1] ?? null;
}

/**
 * Plans the writes without making any. Returns `{ writes: [{ file, text }], notes, errors }`: a
 * write for each file whose content changes, and an error for each fragment found twice or more, or
 * found nowhere after the first run.
 */
export function planInit(root, config) {
  const writes = [];
  const notes = [];
  const errors = [];

  const rulePath = path.join(root, DOCS_RULE);
  const rule = renderDocsRule(config);
  const oldRule = existsSync(rulePath) ? readFileSync(rulePath, 'utf8') : null;
  if (oldRule !== rule) writes.push({ file: DOCS_RULE, text: rule });
  const firstRun = oldRule === null || stampOf(oldRule) === null;

  if (!existsSync(path.join(root, CONFIG_FILE)))
    writes.push({ file: CONFIG_FILE, text: `${JSON.stringify(SKELETON, null, 2)}\n` });
  notes.push('honest-docs-check must report no problems: the Stop gate runs it over all docs on every change.');
  if (!config.guard.command) notes.push(`${CONFIG_FILE} sets no guard.command: the Stop gate runs honest-docs-check alone.`);

  const indexFile = config.index.file;
  const indexPath = path.join(root, indexFile);
  if (!existsSync(indexPath)) {
    errors.push(`${indexFile} not found`);
    return { writes, notes, errors };
  }
  const original = readFileSync(indexPath, 'utf8');
  let text = original;
  const missing = [];
  for (const name of FRAGMENTS) {
    const versions = fragmentVersions(name);
    const found = findFragment(text, versions);
    if (found.length === 0 && firstRun) {
      missing.push({ name, text: versions[0].text });
      continue;
    }
    if (found.length !== 1) {
      errors.push(
        found.length === 0
          ? `${name}: no version of the fragment found in ${indexFile}, though /honest-docs:init has run here — ` +
              `its words were changed; known versions are in templates/fragments/${name}/`
          : `${name}: found ${found.length} times in ${indexFile} (${found.map((f) => f.version).join(', ')})`
      );
      continue;
    }
    const [{ start, end, version }] = found;
    text = text.slice(0, start) + versions[0].text + text.slice(end);
    if (version !== versions[0].version) notes.push(`${name}: ${version} → ${versions[0].version}`);
  }
  if (missing.length > 0) {
    // Appended after what is there, byte for byte: only a blank line is added before the heading.
    const gap = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    text += `${gap}${APPEND_HEADING}\n\n${missing.map((m) => m.text).join('\n\n')}\n`;
    notes.push(
      `appended ${missing.map((m) => m.name).join(' and ')} to ${indexFile} under "${APPEND_HEADING}"; ` +
        'move them anywhere in the file, init finds them by their words'
    );
  }
  if (text !== original) writes.push({ file: indexFile, text });
  return { writes, notes, errors };
}

/** Runs planInit and, only when it found no error, makes every write. */
export function runInit(root, config) {
  const plan = planInit(root, config);
  if (plan.errors.length === 0) {
    for (const { file, text } of plan.writes) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
  }
  return plan;
}

/** What docs-check reports as `init`: `{ file, message }` per problem. */
export function checkInit(root, config) {
  const problems = [];
  const rerun = 'run /honest-docs:init';
  const rulePath = path.join(root, DOCS_RULE);
  if (!existsSync(rulePath)) {
    problems.push({ file: DOCS_RULE, message: `missing — ${rerun}` });
  } else {
    const stamp = stampOf(readFileSync(rulePath, 'utf8'));
    if (stamp === null) problems.push({ file: DOCS_RULE, message: `no /honest-docs:init stamp on the last line — ${rerun}` });
    else if (stamp !== pluginVersion())
      problems.push({ file: DOCS_RULE, message: `written by ${stamp}, the plugin is ${pluginVersion()} — ${rerun}` });
  }

  const indexFile = config.index.file;
  const indexPath = path.join(root, indexFile);
  const text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  for (const name of FRAGMENTS) {
    const [current] = fragmentVersions(name);
    const found = findFragment(text, [current]).length;
    if (found !== 1)
      problems.push({
        file: indexFile,
        message:
          found === 0
            ? `no ${current.version} ${name} fragment — ${rerun}`
            : `the ${name} fragment appears ${found} times`,
      });
  }
  return problems;
}

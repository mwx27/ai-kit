// /honest-docs:init: what it writes into a project, and the check docs-check runs on it.
//
//   .claude/rules/docs.md   templates/docs.md with the config's docsDir and index.file filled in;
//                           the plugin is its only author, so it is overwritten, and its last line
//                           stamps the plugin version. The check compares the rest of the text, not
//                           the stamp, so an update that leaves the rule alone does not fail it
//   .claude/honest-docs.json  a skeleton, written only when the project has none
//   index.file (CLAUDE.md)  two fragments — the `Read` line and the docs policy — each replaced
//                           where it stands by its current version; the rest of the file is the
//                           project's
//
// A fragment is found by the words of any version in templates/fragments/<name>/, whitespace
// between them free, so a rewrap by hand or by Prettier still matches. The current version is the
// newest <v>.md not above the plugin's version, so a release that leaves a fragment alone adds no
// file; one above the plugin's version is ignored. A version named pre-<v> is text that predates the
// plugin: recognised and replaced, never current, never written.
//
// On the first run — no docs.md, or one without a stamp — a fragment found nowhere is appended to
// the end of index.file under one `## honest-docs` heading, read-line first. The project may move
// it anywhere: later runs find it by its words. Once a stamp exists, a fragment found nowhere had
// its words changed, and that is an error. A fragment found twice is an error on every run.
//
// The rule also gets a line in index.file's Rules section (`## <index.rulesHeading>`), at the
// section's end, so docs-check's `index` passes. Without that section init creates it, holding the
// one line, right after the `## honest-docs` section, or at the end of the file when there is none.
// A section that already lists the rule is left alone.
//
// Two things init warns about and does not stop for: a docsDir that does not exist, naming the
// folders that do hold .md files; and a file it maintains that git ignores, which nobody else gets.
import { execFileSync } from 'node:child_process';
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

/** x.y.z → [x, y, z], or null for anything else (pre-<v> included). */
const semver = (version) => version.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number) ?? null;
const compareSemver = (a, b) => a.reduce((diff, n, i) => diff || n - b[i], 0);

/**
 * Every version of a fragment the plugin at `version` knows, `{ version, text }`, the current one
 * first: the newest <v>.md not above `version`. `dir` is for tests.
 */
export function fragmentVersions(name, version = pluginVersion(), dir = path.join(TEMPLATES, 'fragments', name)) {
  const plugin = semver(version);
  const versions = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ version: f.slice(0, -3), text: readFileSync(path.join(dir, f), 'utf8').trim() }))
    .filter((v) => !semver(v.version) || compareSemver(semver(v.version), plugin) <= 0);
  const [current] = versions
    .filter((v) => semver(v.version))
    .sort((a, b) => compareSemver(semver(b.version), semver(a.version)));
  if (!current) throw new Error(`templates/fragments/${name}/ has no version at or below ${version}`);
  return [current, ...versions.filter((v) => v !== current)];
}

/** The words of a text, whatever whitespace separates them: how a fragment and the rule are compared. */
const words = (text) => text.trim().split(/\s+/);
const wordsPattern = (text) => new RegExp(`(?<!\\S)${words(text).map(escapeRe).join('\\s+')}(?!\\S)`, 'g');

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

/**
 * The section of `text` headed `## <heading>`, up to the next `## ` heading, as a match (`index`,
 * `[0]`), or null. docs-check reads the Rules index out of the same section.
 */
export const rulesSection = (text, heading) =>
  text.match(new RegExp(`^## ${escapeRe(heading)}\\b[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm'));

/** Every `.claude/rules/<name>.md` a Rules section names. */
export const listedRules = (section) => new Set(section.match(/\.claude\/rules\/[\w.-]+\.md/g) ?? []);

const rulesLine = (config) => `- [\`docs.md\`](${DOCS_RULE}) — \`${config.docsDir}/\`: what to write and what not to.`;

/** `text` with the docs rule listed in its Rules section, the section created when there is none. */
function withRulesLine(text, config) {
  const heading = config.index.rulesHeading;
  const line = rulesLine(config);
  const section = rulesSection(text, heading);
  if (section) {
    if (listedRules(section[0]).has(DOCS_RULE)) return text;
    const body = section[0].trimEnd();
    const end = section.index + body.length;
    // Straight after a list item it joins the list; after prose it needs a blank line to be one.
    const gap = /^\s*[-*] /.test(body.split('\n').at(-1)) ? '\n' : '\n\n';
    return text.slice(0, end) + gap + line + text.slice(end);
  }
  const block = `## ${heading}\n\n${line}\n`;
  const own = text.match(new RegExp(`^${escapeRe(APPEND_HEADING)}[ \\t]*$`, 'm'));
  const next = own ? text.slice(own.index + own[0].length).search(/^#{1,2} /m) : -1;
  if (next !== -1) {
    const at = own.index + own[0].length + next;
    return `${text.slice(0, at)}${block}\n${text.slice(at)}`;
  }
  return text + (text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n') + block;
}

const DIR_LIST = 10;

/** Folders under `root` holding .md files directly, most files first, node_modules and .git skipped. */
function markdownFolders(root) {
  const counts = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return; // unreadable: a hint for the warning is not worth failing init over
    }
    for (const entry of entries) {
      // isDirectory() is false for a symlink, so a link loop is never followed.
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git')
        walk(dir ? `${dir}/${entry.name}` : entry.name);
      else if (dir && entry.isFile() && entry.name.endsWith('.md')) counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  };
  walk('');
  return [...counts].sort(([a, m], [b, n]) => n - m || a.localeCompare(b));
}

function missingDocsDirWarning(root, config) {
  const folders = markdownFolders(root);
  const shown = folders.slice(0, DIR_LIST).map(([dir, n]) => `${dir}/ (${n})`);
  if (folders.length > DIR_LIST) shown.push(`and ${folders.length - DIR_LIST} more`);
  return (
    `docsDir "${config.docsDir}" does not exist, so honest-docs-check scans no docs there; ` +
    (shown.length > 0 ? `folders holding .md files: ${shown.join(', ')}. ` : 'no folder holds .md files. ') +
    `Set docsDir in ${CONFIG_FILE}, then run /honest-docs:init again.`
  );
}

/**
 * The files among `files` git ignores, `{ file, source }` with source `<file>:<line>:<pattern>`.
 * Empty without git or outside a repo. A tracked file is never reported: git commits it anyway.
 */
export function ignoredByGit(root, files) {
  let output;
  try {
    // -z needs --stdin. Its fields are NUL-separated, so a source path holding a colon (a Windows
    // core.excludesFile, C:/…) cannot be misread.
    output = execFileSync('git', ['-C', root, 'check-ignore', '-v', '-z', '--stdin'], {
      encoding: 'utf8',
      input: files.map((file) => `${file}\0`).join(''),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    // Exit 1 is "none ignored"; anything else (no git, no repo) means no check.
    return [];
  }
  const fields = output.split('\0');
  const ignored = [];
  // Four fields per path: source, line, pattern, path.
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, line, pattern, file] = fields.slice(i, i + 4);
    // With -v a negated pattern that matched is printed too, though the file is not ignored.
    if (!pattern.startsWith('!')) ignored.push({ file, source: `${source}:${line}:${pattern}` });
  }
  return ignored;
}

/** The version stamped in a docs.md, or null when its last line is not a stamp. */
export function stampOf(text) {
  return text.trimEnd().split('\n').at(-1).match(STAMP)?.[1] ?? null;
}

/**
 * Plans the writes without making any. Returns `{ writes: [{ file, text }], notes, warnings, errors }`:
 * a write for each file whose content changes, and an error for each fragment found twice or more, or
 * found nowhere after the first run.
 */
export function planInit(root, config) {
  const writes = [];
  const notes = [];
  const warnings = [];
  const errors = [];

  if (!existsSync(path.join(root, config.docsDir))) warnings.push(missingDocsDirWarning(root, config));

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
    return { writes, notes, warnings, errors };
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
  const listed = withRulesLine(text, config);
  if (listed !== text) {
    notes.push(`listed ${DOCS_RULE} in the "## ${config.index.rulesHeading}" section of ${indexFile}`);
    text = listed;
  }
  if (text !== original) writes.push({ file: indexFile, text });
  return { writes, notes, warnings, errors };
}

/**
 * Runs planInit and, only when it found no error, makes every write; then warns about each file
 * init maintains that git ignores, written this run or not.
 */
export function runInit(root, config) {
  const plan = planInit(root, config);
  if (plan.errors.length > 0) return plan;
  for (const { file, text } of plan.writes) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  const maintained = [DOCS_RULE, CONFIG_FILE, config.index.file].filter((file) => existsSync(path.join(root, file)));
  for (const { file, source } of ignoredByGit(root, maintained))
    plan.warnings.push(`${file} is ignored by git (${source}), so it will not be committed and nobody else gets it.`);
  return plan;
}

/**
 * A docs.md without its last line, the stamp, as words: what the check compares, so a project
 * formatter rewrapping the rule does not fail it.
 */
const ruleWords = (text) => words(text.trimEnd().split('\n').slice(0, -1).join('\n')).join(' ');

/**
 * What docs-check reports as `init`: `{ file, message }` per problem. It compares text, not version
 * numbers, so a plugin update that changes neither the rule nor a fragment reports nothing.
 */
export function checkInit(root, config) {
  const problems = [];
  const rerun = 'run /honest-docs:init';
  const rulePath = path.join(root, DOCS_RULE);
  if (!existsSync(rulePath)) {
    problems.push({ file: DOCS_RULE, message: `missing — ${rerun}` });
  } else if (ruleWords(readFileSync(rulePath, 'utf8')) !== ruleWords(renderDocsRule(config))) {
    problems.push({ file: DOCS_RULE, message: `differs from the rule this plugin writes — ${rerun}` });
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

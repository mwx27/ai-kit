// /honest-docs:init and /honest-docs:update: put the checks into the project, or bring them to the
// plugin's version (scripts/install.mjs).
//
//   .claude/honest-docs/    the copy the hooks and scripts run from: core/ and hooks/*.mjs but the
//                           plugin's notifier, scripts/docs-check.mjs and docs-grep.mjs, templates/
//                           (checkInit renders templates/docs.md), and manifest.json — the version,
//                           the sha256 of each file after \r\n → \n, and the hooks merged into
//                           settings.json
//   .claude/settings.json   the copy's hooks, merged (core/settings-merge.mjs)
//   .prettierignore         `.claude/honest-docs/`, and `.claude/honest-docs-state/` when the state
//                           or logs are kept there, appended when the file exists and nothing covers them
//   .claude/honest-docs-state/  created with its .gitignore (core/state-dir.mjs), so it is ignored
//                           from the first run on
//   the rest                what core/init.mjs plans: the rule, the CLAUDE.md fragments, the Rules
//                           line, Last Updated lines; the config skeleton on init only
//
// init's --docs-dir sets docsDir in the config init creates: a folder inside the repo, never its
// root. It is refused with update, where a config already exists, and when it is not such a folder.
//
// Refusals write nothing: init outside a git repository (attribution and the changed files need
// git), init where a manifest exists, update where none does or where it names a
// newer version than the plugin's, a settings.json that is not a JSON object, a fragment error
// (core/init.mjs), and — unless forced — a copied file changed by hand, which is shown as a diff.
// Warnings, which stop nothing: no .gitignore, or one that leaves node_modules/ in a project with a
// package.json — the Bash hooks hash every untracked file and would time out; files git tracks in
// stateDir or logDir; a stateDir or logDir outside
// STATE_ROOT that git does not ignore; the state and logs of earlier versions, which nothing reads now.
// Update at the plugin's own version is a repair: it copies and merges again.
//
// The project's files are written first and the copy last: it is staged beside the old one,
// manifest.json last, and swapped in by two renames, so a crash leaves the old copy or the new one,
// and a manifest only once everything else is in place.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, COPY_DIR, STATE_ROOT, loadConfig, usesStateRoot } from './config.mjs';
import { ignoredByGit } from './git-ignored.mjs';
import { DOCS_RULE, compareSemver, planInit, semver } from './init.mjs';
import { PLUGIN_ROOT, pluginVersion } from './log.mjs';
import { SETTINGS_FILE, SettingsError, copyHooks, mergeHooks } from './settings-merge.mjs';
import { makeDir } from './state-dir.mjs';
import { MANIFEST } from './version.mjs';

export const PRETTIER_IGNORE = '.prettierignore';

/** sha256 of a copied file as the manifest records it: line endings do not count. */
export const fileHash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

/** Every file under `dir` (relative to `base`), POSIX paths, sorted. */
function filesUnder(base, dir) {
  const full = path.join(base, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(base, rel) : [rel];
    })
    .sort();
}

/** The plugin's own hook (core/notify.mjs): it checks the copy, so the copy does not carry it. */
const PLUGIN_ONLY = ['core/notify.mjs', 'hooks/notify.mjs'];

/** What the copy holds, as Map of path → text, read from the running plugin. */
export function copySources() {
  const files = [
    ...filesUnder(PLUGIN_ROOT, 'core').filter((f) => !PLUGIN_ONLY.includes(f)),
    ...filesUnder(PLUGIN_ROOT, 'hooks').filter((f) => /^hooks\/[^/]+\.mjs$/.test(f) && !PLUGIN_ONLY.includes(f)),
    'scripts/docs-check.mjs',
    'scripts/docs-grep.mjs',
    ...filesUnder(PLUGIN_ROOT, 'templates'),
  ];
  return new Map(files.map((file) => [file, readFileSync(path.join(PLUGIN_ROOT, file), 'utf8')]));
}

/** The lines of `text`, a trailing newline not making an empty last line. */
const lines = (text) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/** A unified diff of `a` → `b` with three lines of context, or '' when they are the same. */
export function unifiedDiff(a, b, fromName, toName) {
  const x = lines(a);
  const y = lines(b);
  // Longest common subsequence, from the end, so the walk below goes forward.
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push({ op: ' ', text: x[i++] });
      j++;
    } else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push({ op: '-', text: x[i++] });
    else ops.push({ op: '+', text: y[j++] });
  }
  const CONTEXT = 3;
  const changed = ops.map((o, k) => (o.op === ' ' ? -1 : k)).filter((k) => k !== -1);
  if (changed.length === 0) return '';
  const hunks = [];
  for (const k of changed) {
    const last = hunks.at(-1);
    if (last && k - last.end <= 2 * CONTEXT) last.end = k;
    else hunks.push({ start: k, end: k });
  }
  const out = [`--- ${fromName}`, `+++ ${toName}`];
  for (const { start, end } of hunks) {
    const from = Math.max(0, start - CONTEXT);
    const to = Math.min(ops.length - 1, end + CONTEXT);
    const slice = ops.slice(from, to + 1);
    // Line numbers: count what precedes the hunk on each side.
    const before = ops.slice(0, from);
    const aStart = before.filter((o) => o.op !== '+').length + 1;
    const bStart = before.filter((o) => o.op !== '-').length + 1;
    const aLen = slice.filter((o) => o.op !== '+').length;
    const bLen = slice.filter((o) => o.op !== '-').length;
    out.push(`@@ -${aLen === 0 ? aStart - 1 : aStart},${aLen} +${bLen === 0 ? bStart - 1 : bStart},${bLen} @@`);
    for (const o of slice) out.push(`${o.op}${o.text}`);
  }
  return `${out.join('\n')}\n`;
}

/** Whether a .prettierignore line keeps Prettier out of `dir` (a folder under .claude/). */
function covers(line, dir) {
  const pattern = line.trim();
  if (pattern === '' || pattern.startsWith('#') || pattern.startsWith('!')) return false;
  const bare = pattern.replace(/^\//, '').replace(/\/(\*\*?)?$/, '');
  return bare === '.claude' || bare === dir;
}

/** Where 0.2.0 and earlier kept what 0.2.1 keeps in STATE_ROOT, for the config's stateDir and logDir. */
function earlierState(root, config) {
  const found = [];
  const sessions = config.stateDir === STATE_ROOT ? 'artifacts/claude-hooks/honest-docs' : `${config.stateDir}/honest-docs`;
  if (existsSync(path.join(root, sessions))) found.push(`${sessions}/`);
  if (config.logDir === `${STATE_ROOT}/logs`) {
    let names = [];
    try {
      names = readdirSync(path.join(root, 'artifacts/logs'));
    } catch {
      // No earlier logs.
    }
    if (names.includes('events.jsonl')) found.push('artifacts/logs/events.jsonl');
    for (const prefix of ['guard-gate-', 'instructions-']) {
      const count = names.filter((name) => name.startsWith(prefix) && name.endsWith('.log')).length;
      if (count > 0) found.push(`artifacts/logs/${prefix}*.log (${count} file${count === 1 ? '' : 's'})`);
    }
  }
  return found;
}

/** The files git tracks under `dirs` (repo-relative); empty without git. */
function trackedUnder(root, dirs) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...dirs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * `dir` as a docsDir, repo-relative POSIX without a trailing slash, or null when it is not a folder
 * inside the repo: absolute, above it, or the repo root itself, whose scan would cover everything.
 */
export function docsDirArg(dir) {
  if (typeof dir !== 'string' || /^[A-Za-z]:/.test(dir)) return null;
  const norm = path.posix.normalize(dir.replace(/\\/g, '/')).replace(/\/+$/, '');
  if (norm === '' || norm === '.' || norm === '..' || norm.startsWith('../') || path.posix.isAbsolute(norm)) return null;
  return norm;
}

/** Whether `root` is the top of a git work tree. */
function isGitRoot(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.resolve(top) === path.resolve(root) || realpathSync.native(top) === realpathSync.native(root);
  } catch {
    return false;
  }
}

/**
 * The Bash hooks hash every untracked file before and after each call (core/changed-files.mjs), so
 * an unignored node_modules/ runs them past their timeout and the call goes unattributed.
 */
function gitignoreWarnings(root) {
  if (!existsSync(path.join(root, '.gitignore')))
    return ['this repo has no .gitignore; the hooks hash every untracked file around each Bash call, so dependencies or build output left unignored can make them time out'];
  if (existsSync(path.join(root, 'package.json')) && ignoredByGit(root, ['node_modules/honest-docs-probe']).length === 0)
    return ['.gitignore does not ignore node_modules/; the hooks hash every untracked file around each Bash call, so after an install they can time out'];
  return [];
}

/** The warnings about where the hooks write: tracked files there, an unignored folder, earlier state. */
function stateWarnings(root, config) {
  const warnings = [];
  // logDir inside stateDir (the default) is named once, as part of stateDir.
  const dirs = [config.stateDir, config.logDir].filter((dir, i, all) => !all.some((other, j) => j !== i && (dir === other ? j < i : dir.startsWith(`${other}/`))));
  const tracked = trackedUnder(root, dirs);
  if (tracked.length > 0)
    warnings.push(
      `git tracks ${tracked.length} file${tracked.length === 1 ? '' : 's'} under ${dirs.map((d) => `${d}/`).join(' and ')}, where the hooks keep session state and logs; remove ${tracked.length === 1 ? 'it' : 'them'} from the repo`
    );
  const outside = dirs.filter((dir) => dir !== STATE_ROOT && !dir.startsWith(`${STATE_ROOT}/`));
  const ignored = new Set(ignoredByGit(root, outside.map((dir) => `${dir}/honest-docs-probe`)).map(({ file }) => file));
  for (const dir of outside)
    if (!ignored.has(`${dir}/honest-docs-probe`))
      warnings.push(`git does not ignore ${dir}/, where the config keeps the hooks' state or logs; add it to .gitignore, or they will show up in git status`);
  const earlier = earlierState(root, config);
  if (earlier.length > 0)
    warnings.push(`honest-docs no longer reads the state and logs of earlier versions; delete them when you no longer need them: ${earlier.join(', ')}`);
  return warnings;
}

/** The `## [x.y.z]` sections of the plugin's CHANGELOG.md above `from` and up to `to`, newest first. */
export function changelogBetween(from, to) {
  const file = path.join(PLUGIN_ROOT, 'CHANGELOG.md');
  if (!existsSync(file) || !semver(from) || !semver(to)) return [];
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return text
    .split(/^(?=## \[)/m)
    .map((section) => ({ version: section.match(/^## \[([^\]]+)\]/)?.[1], text: section.replace(/\n-{3,}\s*$/, '').trim() }))
    .filter(({ version }) => version && semver(version))
    .filter(({ version }) => compareSemver(semver(version), semver(from)) > 0 && compareSemver(semver(version), semver(to)) <= 0)
    .sort((a, b) => compareSemver(semver(b.version), semver(a.version)))
    .map((section) => section.text);
}

const readJsonFile = (file) => JSON.parse(readFileSync(file, 'utf8'));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Plans an install without writing anything. Returns `{ mode, version, from, writes, settings,
 * prettier, copy, notes, nexts, warnings, errors, refusal, conflicts }`: `writes` the project's files
 * ({ file, text, mtime? }), `settings` and `prettier` the text to write or null, `copy` the files
 * and manifest of the new copy, `refusal` why nothing may be written, `conflicts` the hand-edited
 * copied files with their diffs.
 */
export function planInstall(root, config, { mode, force = false, docsDir }) {
  const version = pluginVersion();
  const plan = {
    mode,
    version,
    from: null,
    writes: [],
    settings: null,
    prettier: null,
    copy: null,
    notes: [],
    nexts: [],
    warnings: [],
    errors: [],
    refusal: null,
    conflicts: [],
  };
  const copyDir = path.join(root, COPY_DIR);
  const manifestFile = path.join(copyDir, MANIFEST);
  const installed = existsSync(manifestFile);
  let manifest = null;
  if (installed) {
    try {
      manifest = readJsonFile(manifestFile);
      if (!isObject(manifest) || typeof manifest.version !== 'string') throw new Error('no "version" string');
    } catch (error) {
      manifest = null;
      if (mode === 'update') {
        plan.refusal = `${COPY_DIR}/${MANIFEST} cannot be read (${error.message}); remove ${COPY_DIR}/ and run /honest-docs:init`;
        return plan;
      }
    }
  }
  if (mode === 'init' && !isGitRoot(root)) {
    plan.refusal = 'not a git repository: run git init here, then /honest-docs:init again';
    return plan;
  }
  if (docsDir !== undefined) {
    if (mode !== 'init') plan.refusal = `--docs-dir is for init only; docsDir is set in ${CONFIG_FILE}`;
    else if (existsSync(path.join(root, CONFIG_FILE))) plan.refusal = `docsDir is set in ${CONFIG_FILE}; edit it there`;
    else if (docsDirArg(docsDir) === null) plan.refusal = `--docs-dir ${JSON.stringify(docsDir)}: name a folder inside the repo, not its root`;
    if (plan.refusal) return plan;
    config = loadConfig(root, { docsDir: docsDirArg(docsDir) });
  }
  if (mode === 'init' && installed) {
    plan.refusal = `already installed (${manifest?.version ?? 'unreadable manifest'}): run /honest-docs:update`;
    return plan;
  }
  if (mode === 'update') {
    if (!installed) {
      plan.refusal = 'not installed here: run /honest-docs:init';
      return plan;
    }
    const ours = semver(version);
    const theirs = semver(manifest.version);
    if (!ours || !theirs || compareSemver(theirs, ours) > 0) {
      plan.refusal = `this repo's copy is ${manifest.version}, the plugin is ${version}: run claude plugin update`;
      return plan;
    }
    plan.from = manifest.version;
  }

  // settings.json
  const settingsFile = path.join(root, SETTINGS_FILE);
  let settings = {};
  if (existsSync(settingsFile)) {
    try {
      settings = readJsonFile(settingsFile);
    } catch (error) {
      plan.refusal = `${SETTINGS_FILE} is not valid JSON (${error.message})`;
      return plan;
    }
    if (!isObject(settings)) {
      plan.refusal = `${SETTINGS_FILE} is not a JSON object`;
      return plan;
    }
  }
  const hooks = copyHooks();
  try {
    const merged = mergeHooks(settings, { previous: manifest?.hooks ?? null, next: hooks, version });
    if (merged.changed || !existsSync(settingsFile)) plan.settings = `${JSON.stringify(merged.settings, null, 2)}\n`;
    plan.nexts.push(...merged.nexts);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    plan.refusal = error.message;
    return plan;
  }

  // The rule, the fragments, the Rules line, the Last Updated lines, the config skeleton.
  const init = planInit(root, config, { mode });
  plan.errors.push(...init.errors);
  if (plan.errors.length > 0) return plan;
  plan.writes = init.writes.filter((w) => mode === 'init' || w.file !== CONFIG_FILE);
  plan.notes.push(...init.notes);
  plan.warnings.push(...init.warnings);

  plan.warnings.push(...gitignoreWarnings(root), ...stateWarnings(root, config));

  // .prettierignore: Prettier reads neither the copy's settings nor STATE_ROOT's nested .gitignore.
  const keepOut = [COPY_DIR, ...(usesStateRoot(config) ? [STATE_ROOT] : [])];
  const prettierFile = path.join(root, PRETTIER_IGNORE);
  if (existsSync(prettierFile)) {
    const text = readFileSync(prettierFile, 'utf8');
    const lines = text.split(/\r?\n/);
    const missing = keepOut.filter((dir) => !lines.some((line) => covers(line, dir)));
    if (missing.length > 0)
      plan.prettier = `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${missing.map((dir) => `${dir}/\n`).join('')}`;
  } else {
    plan.nexts.push(`Prettier: add ${keepOut.map((dir) => `${dir}/`).join(' and ')} to your ignore file`);
  }
  plan.nexts.push(`if ESLint or tsc check .claude/, exclude ${COPY_DIR}/ there`);

  // The copy: refused over a file changed by hand since the manifest recorded it, unless forced.
  const files = copySources();
  const recorded = isObject(manifest?.files) ? manifest.files : {};
  const local = filesUnder(copyDir, '.').map((f) => f.replace(/^\.\//, '')).filter((f) => f !== MANIFEST);
  let changedFiles = 0;
  for (const file of [...new Set([...local, ...files.keys()])].sort()) {
    const next = files.get(file) ?? null;
    const mine = local.includes(file) ? readFileSync(path.join(copyDir, file), 'utf8') : null;
    if (mine === null || next === null || fileHash(mine) !== fileHash(next)) changedFiles++;
    if (mine === null || recorded[file] === fileHash(mine)) continue;
    if (next !== null && fileHash(mine) === fileHash(next)) continue;
    plan.conflicts.push({
      file: `${COPY_DIR}/${file}`,
      diff: unifiedDiff(mine, next ?? '', `${COPY_DIR}/${file} (yours)`, next === null ? '/dev/null' : `${COPY_DIR}/${file} (${version})`),
    });
  }
  if (plan.conflicts.length > 0 && !force) {
    plan.refusal = `${plan.conflicts.length} file${plan.conflicts.length === 1 ? '' : 's'} in ${COPY_DIR}/ changed by hand since honest-docs wrote ${plan.conflicts.length === 1 ? 'it' : 'them'}; rerun with --force to overwrite`;
    return plan;
  }
  plan.copy = {
    files,
    changed: changedFiles,
    manifest: {
      version,
      files: Object.fromEntries([...files].map(([file, text]) => [file, fileHash(text)])),
      hooks,
    },
  };
  return plan;
}

/**
 * Writes the copy into a staging folder beside COPY_DIR, manifest.json last, and swaps it in.
 * `beforeSwap` is for tests: it runs after staging, and what it throws aborts the swap.
 */
function swapCopy(root, copy, beforeSwap) {
  const target = path.join(root, COPY_DIR);
  const stage = `${target}.tmp-${process.pid}`;
  const old = `${target}.old-${process.pid}`;
  rmSync(stage, { recursive: true, force: true });
  try {
    for (const [file, text] of copy.files) {
      mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      writeFileSync(path.join(stage, file), text);
    }
    writeFileSync(path.join(stage, MANIFEST), `${JSON.stringify(copy.manifest, null, 2)}\n`);
    beforeSwap?.();
    if (existsSync(target)) renameSync(target, old);
    renameSync(stage, target);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (!existsSync(target) && existsSync(old)) renameSync(old, target);
    throw error;
  }
  rmSync(old, { recursive: true, force: true });
}

/**
 * Runs planInstall and, only without a refusal or an error, makes every write; then warns about each
 * file it maintains that git ignores, written this run or not.
 */
export function runInstall(root, config, { mode, force = false, docsDir, beforeSwap } = {}) {
  const plan = planInstall(root, config, { mode, force, docsDir });
  if (plan.refusal || plan.errors.length > 0) return plan;
  for (const { file, text, mtime } of plan.writes) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
    if (mtime) utimesSync(path.join(root, file), new Date(), mtime);
  }
  if (plan.settings !== null) {
    mkdirSync(path.dirname(path.join(root, SETTINGS_FILE)), { recursive: true });
    writeFileSync(path.join(root, SETTINGS_FILE), plan.settings);
  }
  if (plan.prettier !== null) writeFileSync(path.join(root, PRETTIER_IGNORE), plan.prettier);
  if (usesStateRoot(config)) makeDir(path.join(root, STATE_ROOT));
  swapCopy(root, plan.copy, beforeSwap);

  const maintained = [DOCS_RULE, CONFIG_FILE, config.index.file, SETTINGS_FILE, `${COPY_DIR}/${MANIFEST}`].filter((file) =>
    existsSync(path.join(root, file))
  );
  for (const { file, source } of ignoredByGit(root, maintained))
    plan.warnings.push(`${file} is ignored by git (${source}), so it will not be committed and nobody else gets it.`);
  return plan;
}

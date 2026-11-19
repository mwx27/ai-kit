// The project's .claude/honest-docs.json over the defaults, and the project root for the scripts.
//
// Every key is optional. A project sets only what differs from the defaults below:
//
//   docsDir         the folder of docs that carry `covers:` and a Last Updated line
//   undated         folders under docsDir exempt from the Last Updated check (e.g. generated pages)
//   scan            where docs-check and docs-grep look: `dirs` (default: docsDir, .claude/rules,
//                   .claude/skills) and root-level `files`; a file git ignores is never scanned
//                   (core/doc-set.mjs)
//   rootFiles       root-level file names docs-check verifies when a doc quotes one in backticks
//   absentByDesign  paths a doc may name that a clean checkout does not have
//   absentScripts   script names a doc runs (`npm run`, `pnpm run`, `yarn run`, `bun run`) while
//                   saying they do not exist
//   index           the docs index docs-check verifies: `file`, the `groups` under docsDir it must
//                   list, and the `rulesHeading` of the section that lists .claude/rules/
//   stateDir        the hooks' state, a folder per session under `sessions/`; excluded from the
//                   changed files (default: STATE_ROOT, below)
//   logDir          the event log, the gate's and the instructions log's files; excluded from the
//                   changed files (default: STATE_ROOT/logs)
//   timeZone        IANA zone of the Last Updated stamp (default: the system's)
//   guard.command   argv of the project's guard, called as `<argv…> --changed <files…>` after
//                   docs-check passes; with none the Stop gate runs docs-check alone
//   instructionsLog true turns on the instructions log (a measurement, off by default)
//   docsAudit       what /docs-audit treats as library, native and prebuild folders
//
// A file that is not valid JSON, or whose top level is not an object, throws a ConfigError; what
// each caller does with it is in references/hooks.md. Of the values inside only `guard` is
// validated, because a malformed one would switch the project's guard off in silence; a missing or
// null `guard` or `guard.command` means no guard.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = '.claude/honest-docs.json';

/** Where /honest-docs:init copies the hooks and scripts in a project (core/version.mjs). */
export const COPY_DIR = '.claude/honest-docs';

/**
 * Where the hooks keep their state and logs unless the config moves them. The folder ignores itself
 * in git (core/state-dir.mjs), so nothing in it reaches git status whatever the project's .gitignore says.
 */
export const STATE_ROOT = '.claude/honest-docs-state';

/** A config file the project has but the plugin cannot use. The message starts with the file name. */
export class ConfigError extends Error {
  constructor(detail) {
    super(`${CONFIG_FILE}: ${detail}`);
    this.name = 'ConfigError';
  }
}

const DEFAULTS = {
  docsDir: '_docs',
  undated: [],
  scan: { dirs: null, files: ['CLAUDE.md', 'README.md'] },
  rootFiles: [],
  absentByDesign: [],
  absentScripts: [],
  index: { file: 'CLAUDE.md', groups: ['features', 'tools'], rulesHeading: 'Rules' },
  stateDir: STATE_ROOT,
  logDir: `${STATE_ROOT}/logs`,
  timeZone: null,
  guard: { command: null },
  instructionsLog: false,
  docsAudit: {
    libraryDir: 'node_modules',
    nativeDirs: ['android', 'ios', 'cpp', 'apple', 'common'],
    prebuildDirs: [],
  },
};

export const DEFAULT_LOG_DIR = DEFAULTS.logDir;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const trimSlash = (p) => p.replace(/\/+$/, '');

/**
 * The config, defaults filled in. Throws a ConfigError on a file that is there but unusable.
 * `overrides` stand in for keys of a config not written yet (init's --docs-dir, core/install.mjs).
 */
export function loadConfig(root, overrides = {}) {
  const file = path.join(root, CONFIG_FILE);
  let own = {};
  if (existsSync(file)) {
    try {
      own = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(`not valid JSON (${error.message})`);
    }
  }
  if (!isObject(own)) throw new ConfigError('not a JSON object');
  own = { ...own, ...overrides };
  if (own.guard != null) {
    if (!isObject(own.guard)) throw new ConfigError('guard must be an object, like { "command": [...] }');
    const { command } = own.guard;
    if (command != null && !(Array.isArray(command) && command.length > 0 && command.every((a) => typeof a === 'string')))
      throw new ConfigError('guard.command must be an array of strings, like ["bash", "scripts/guard.sh"]');
  }

  const config = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    config[key] = isObject(value) && isObject(own[key]) ? { ...value, ...own[key] } : (own[key] ?? value);
  }
  config.docsDir = trimSlash(config.docsDir);
  config.stateDir = trimSlash(config.stateDir);
  config.logDir = trimSlash(config.logDir);
  config.scan.dirs ??= [config.docsDir, '.claude/rules', '.claude/skills'];
  return config;
}

/** The plugin's own folders, which no check counts as a change: its state, its logs and its copy. */
export const ownDirs = (config) => [`${config.stateDir}/`, `${config.logDir}/`, `${COPY_DIR}/`];

/** Whether stateDir or logDir lies in STATE_ROOT, the folder that ignores itself. */
export const usesStateRoot = (config) =>
  [config.stateDir, config.logDir].some((dir) => dir === STATE_ROOT || dir.startsWith(`${STATE_ROOT}/`));

const SKIPPED_NAMES = ['node_modules', '.git'];

/**
 * Whether a walk of the tree skips the repo-relative POSIX path `rel`: git and dependencies at any
 * depth, and the plugin's state and logs by their full path, so a folder of the same name elsewhere
 * (another `.claude/`, say) is still walked.
 */
export function skippedPath(config) {
  const own = [`${config.stateDir}/`, `${config.logDir}/`];
  return (rel) => rel.split('/').some((segment) => SKIPPED_NAMES.includes(segment)) || own.some((dir) => `${rel}/`.startsWith(dir));
}

/**
 * The root the scripts work on. They run from Bash, where CLAUDE_PROJECT_DIR is not set, so the
 * root is the enclosing git repository, or the working directory outside one.
 */
export function projectRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

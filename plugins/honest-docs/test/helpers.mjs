// Run from plugins/honest-docs/: node --test
//
// Shared by the *.test.mjs files: a throwaway git repo in os.tmpdir() per test, and runners for the
// hooks and scripts of a copy in it (.claude/honest-docs/), the way Claude Code and the agent's Bash
// call them.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.mjs';
import { fragmentVersions, renderDocsRule } from '../core/init.mjs';
import { copySources, fileHash } from '../core/install.mjs';
import { copyHooks } from '../core/settings-merge.mjs';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_VERSION = JSON.parse(
  readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
).version;

/** A fragment's text: the given version, or without one the current version, as /init picks it. */
export const fragment = (name, version) =>
  version === undefined
    ? fragmentVersions(name)[0].text
    : readFileSync(path.join(PLUGIN_ROOT, 'templates', 'fragments', name, `${version}.md`), 'utf8').trim();

/** The version /init writes of a fragment. */
export const fragmentVersion = (name) => fragmentVersions(name)[0].version;

/**
 * The parent environment without anything from the Claude Code session running the tests, or from a
 * git operation in progress, so a test sees only the variables it sets itself.
 */
export function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(CLAUDE|HONEST_DOCS_|GIT_)/.test(key))
  );
  return { ...env, ...extra };
}

const GIT_ENV = cleanEnv({
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
});

export const git = (root, ...args) =>
  execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Writes `files` ({ relative path: content }) under `root`, folders included. */
export function writeFiles(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

/**
 * A fresh temporary folder holding `repo/`, a git repo with `files` committed, removed when the test
 * ends. `dir` is the folder around it, for fixtures that must stay outside the repo (the guard).
 * Paths are real paths, as git reports them: on macOS os.tmpdir() is a symlink, and on Windows it
 * can hold an 8.3 name (RUNNER~1).
 */
export function tmpRepo(t, files = {}) {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'honest-docs-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFiles(root, { '.gitkeep': '', ...files });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return { dir, root };
}

export const COPY = '.claude/honest-docs';

/**
 * The copy /honest-docs:init puts in `root` (core/install.mjs: the same files and a manifest), unless
 * one is there; returns its folder. Not committed, and nothing else init writes.
 */
export function writeCopy(root) {
  const copy = path.join(root, COPY);
  if (existsSync(path.join(copy, 'manifest.json'))) return copy;
  const files = copySources();
  writeFiles(copy, Object.fromEntries(files));
  const manifest = { version: PLUGIN_VERSION, files: Object.fromEntries([...files].map(([file, text]) => [file, fileHash(text)])), hooks: copyHooks() };
  writeFiles(copy, { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` });
  return copy;
}

/** One hook of the copy in `root` as settings.json runs it: the payload as JSON on stdin, CLAUDE_PROJECT_DIR in env. */
export function runHook(hook, payload, { root, env = {} }) {
  const run = spawnSync('node', [path.join(writeCopy(root), 'hooks', `${hook}.mjs`)], {
    cwd: root,
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** The repo `cwd` is in, or `cwd` outside one. */
function repoOf(cwd) {
  try {
    return path.resolve(git(cwd, 'rev-parse', '--show-toplevel').trim());
  } catch {
    return cwd;
  }
}

/**
 * One of the copy's scripts (`docs-check`, `docs-grep`) as the agent runs it in Bash:
 * `node .claude/honest-docs/scripts/<script>.mjs`, from inside the project, no CLAUDE_* in env.
 */
export function runScript(script, args, { cwd, env = {} }) {
  const run = spawnSync(process.execPath, [path.join(writeCopy(repoOf(cwd)), 'scripts', `${script}.mjs`), ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** scripts/install.mjs as the init and update skills run it, from `pluginRoot` (this plugin by default). */
export function runInstall(cwd, mode, { args = [], pluginRoot = PLUGIN_ROOT, env = {} } = {}) {
  const run = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'install.mjs'), '--mode', mode, ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const readLines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean);

/** The event log (core/log.mjs) under the default logDir of `root`, parsed; [] when there is none. */
export const eventLog = (root) => {
  const file = path.join(root, 'artifacts', 'logs', 'events.jsonl');
  return existsSync(file) ? readLines(file).map((line) => JSON.parse(line)) : [];
};

/** `text` matched literally inside a RegExp: a Windows path's `\U` or `\A` breaks the pattern otherwise. */
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What docs-check needs besides the rule to pass: package.json, and CLAUDE.md with both fragments. */
export const docsBaseline = () => ({
  'package.json': '{ "name": "fixture" }\n',
  'CLAUDE.md': `# Fixture

${fragment('read-line')}

## Docs

${fragment('docs-policy')}

## Rules

- [docs](.claude/rules/docs.md)
`,
});

/** Writes the rule /init writes, rendered from the project's config, so docs-check's `init` passes. */
export const writeDocsRule = (root) =>
  writeFiles(root, { '.claude/rules/docs.md': renderDocsRule(loadConfig(root)) });

/** The session's state folder (core/session-state.mjs) under the default stateDir. */
export const sessionPath = (root, session, file = '') => path.join(root, 'artifacts/claude-hooks/honest-docs', session, file);

let toolCalls = 0;

/**
 * One agent session's tool-call hooks on `root`, fired as Claude Code fires them. `run(hook, payload)`
 * runs one hook: the plugin's by default, a copy's in the copy tests.
 *   start(source)            SessionStart
 *   write(file, text, tool)  writes the file, then the tool's PostToolUse (Write by default)
 *   bash(act, options)       PreToolUse, act(), then PostToolUse (or `event`); `pre: false` skips the Pre
 *   tool(name, input)        a PostToolUse with that tool_input, nothing written
 *   pre(id), post(id)        one Bash call's Pre or Post alone, to interleave calls
 * Each returns the hook's run, with `output` the parsed stdout when it is JSON.
 */
export function agentSession(root, session, { run, cwd = root } = {}) {
  run ??= (hook, payload) => runHook(hook, payload, { root });
  const fire = (hook, payload) => {
    const result = run(hook, { session_id: session, cwd, ...payload });
    let output = null;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      // Plain text, or nothing.
    }
    return { ...result, output };
  };
  return {
    start: (source = 'startup') => fire('session-start', { hook_event_name: 'SessionStart', source }),
    write(file, text, tool = 'Write') {
      writeFiles(cwd, { [file]: text });
      const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
      return fire('post-tool', { hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: `toolu_${++toolCalls}`, tool_input: { [key]: path.join(cwd, file) } });
    },
    bash(act = () => {}, { event = 'PostToolUse', pre = true, id = `toolu_${++toolCalls}` } = {}) {
      const call = { tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'fixture' } };
      if (pre) fire('pre-tool', { hook_event_name: 'PreToolUse', ...call });
      act();
      return fire('post-tool', { hook_event_name: event, ...call, ...(event === 'PostToolUseFailure' ? { error: 'exit 1', is_interrupt: false } : {}) });
    },
    /** PostToolUse of `tool` with `toolInput` as given, nothing written. */
    tool: (tool, toolInput) => fire('post-tool', { hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: `toolu_${++toolCalls}`, tool_input: toolInput }),
    pre: (id) => fire('pre-tool', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'fixture' } }),
    post: (id) => fire('post-tool', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'fixture' } }),
  };
}

/** The attributed.jsonl lines of `session`, parsed; [] when there are none. */
export const attributedLines = (root, session) => {
  const file = sessionPath(root, session, 'attributed.jsonl');
  return existsSync(file) ? readLines(file).map((line) => JSON.parse(line)) : [];
};

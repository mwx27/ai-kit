// Run from the repo root: node --test plugins/honest-docs/test/*.test.mjs
//
// Shared by the *.test.mjs files: a throwaway git repo in os.tmpdir() per test, and runners for the
// plugin's hooks and bin/ commands the way Claude Code and the agent's Bash call them.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.mjs';
import { fragmentVersions, renderDocsRule } from '../core/init.mjs';

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
 * Paths are real paths: on macOS os.tmpdir() is a symlink, and git reports the resolved one.
 */
export function tmpRepo(t, files = {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'honest-docs-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  writeFiles(root, { '.gitkeep': '', ...files });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return { dir, root };
}

/** One hook as Claude Code runs it: the payload as JSON on stdin, CLAUDE_PROJECT_DIR in env. */
export function runHook(hook, payload, { root, env = {} }) {
  const run = spawnSync('node', [path.join(PLUGIN_ROOT, 'hooks', `${hook}.mjs`)], {
    cwd: root,
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** One bin/ command as the agent runs it in Bash: from inside the project, no CLAUDE_* in env. */
export function runBin(command, args, { cwd, env = {} }) {
  const run = spawnSync('bash', [path.join(PLUGIN_ROOT, 'bin', command), ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const readLines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean);

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
